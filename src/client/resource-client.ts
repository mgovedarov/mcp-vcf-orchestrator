import { readFile, writeFile } from "node:fs/promises";
import type { ResourceElement, ResourceElementList } from "../types.js";
import { getLinkAttrs, type AttributeLink } from "./attrs.js";
import type { VroHttpClient } from "./core.js";
import {
  assertRealPathInside,
  getExistingFile,
  rejectSymlink,
  resolveFileInDirectory,
} from "./files.js";

export class ResourceClient {
  constructor(private http: VroHttpClient) {}

  async listResources(filter?: string): Promise<ResourceElementList> {
    let path = "/resources";
    if (filter) {
      path += `?conditions=name~${encodeURIComponent(filter)}`;
    }
    const raw = await this.http.get<{
      link?: AttributeLink[];
      total?: number;
      start?: number;
    }>(path);
    const link: ResourceElement[] = (raw.link ?? []).map((item) => {
      const a = getLinkAttrs(item);
      const id = a["id"] ?? a["@id"] ?? item.href?.split("/").pop() ?? "";
      return {
        id,
        name: a["name"] ?? a["@name"] ?? id,
        description: a["description"],
        version: a["version"],
        categoryId: a["categoryId"],
        categoryName: a["categoryName"],
        mimeType: a["mimeType"] ?? a["mime-type"] ?? a["mimetype"],
        href: item.href,
      };
    });
    return { total: raw.total ?? link.length, start: raw.start, link };
  }

  getResourceDirectory(): string {
    return this.http.resourceDir;
  }

  private resolveResourcePath(fileName: string): Promise<string> {
    return resolveFileInDirectory(
      this.http.resourceDir,
      fileName,
      "Resource",
      "the configured resource artifact directory",
    );
  }

  async exportResource(
    id: string,
    fileName: string,
    overwrite = false,
  ): Promise<string> {
    const destPath = await this.resolveResourcePath(fileName);
    const existingFile = await getExistingFile(destPath);
    if (existingFile?.isSymbolicLink()) {
      throw new Error("Resource export target must not be a symbolic link");
    }
    if (existingFile && !overwrite) {
      throw new Error(
        `Resource file already exists: ${fileName}. Set overwrite to true to replace it.`,
      );
    }
    const token = await this.http.ensureAuthenticated();
    const path = `/resources/${encodeURIComponent(id)}`;
    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] GET ${path}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "*/*",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vRO API error: ${res.status} ${res.statusText} — export resource\n${text}`,
      );
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(destPath, buffer, { flag: overwrite ? "w" : "wx" });
    return destPath;
  }

  private async readResourceFile(fileName: string): Promise<Buffer> {
    const srcPath = await this.resolveResourcePath(fileName);
    await rejectSymlink(
      srcPath,
      "Resource import source must not be a symbolic link",
    );
    await assertRealPathInside(
      this.http.resourceDir,
      srcPath,
      "Resource file path resolves outside the configured resource artifact directory",
    );
    return readFile(srcPath);
  }

  private async postResourceForm(
    path: string,
    form: FormData,
    changesetSha?: string,
  ): Promise<void> {
    const token = await this.http.ensureAuthenticated();
    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] POST ${path}`);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (changesetSha) {
      headers["X-VRO-Changeset-Sha"] = changesetSha;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vRO API error: ${res.status} ${res.statusText} — POST ${path}\n${text}`,
      );
    }
  }

  async importResource(categoryId: string, fileName: string): Promise<void> {
    const buffer = await this.readResourceFile(fileName);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)]), fileName);
    form.append("categoryId", categoryId);
    await this.postResourceForm("/resources", form);
  }

  async updateResourceContent(
    id: string,
    fileName: string,
    changesetSha?: string,
  ): Promise<void> {
    const buffer = await this.readResourceFile(fileName);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)]), fileName);
    await this.postResourceForm(
      `/resources/${encodeURIComponent(id)}`,
      form,
      changesetSha,
    );
  }

  async deleteResource(id: string, force = false): Promise<void> {
    const path = `/resources/${encodeURIComponent(id)}${force ? "?force=true" : ""}`;
    await this.http.del<unknown>(path);
  }
}
