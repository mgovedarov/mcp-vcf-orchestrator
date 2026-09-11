import { readFile, writeFile } from "node:fs/promises";
import type { ListOptions, ResourceElement, ResourceElementList } from "../types.js";
import { getLinkAttrs, type AttributeLink } from "./attrs.js";
import { createUploadForm, type VroHttpClient } from "./core.js";
import {
  assertRealPathInside,
  getExistingFile,
  rejectSymlink,
  resolveFileInDirectory,
} from "./files.js";
import { getFilteredVroList } from "./pagination.js";

export class ResourceClient {
  constructor(private http: VroHttpClient) {}

  async listResources(filter?: string, options?: ListOptions): Promise<ResourceElementList> {
    const params = new URLSearchParams();
    // Trimmed so the server-side query and the client-side needle agree on
    // what counts as a filter: a blank one is neither sent nor matched, and a
    // padded one selects the same names on both. See getFilteredVroList.
    const trimmedFilter = filter?.trim();
    if (trimmedFilter) {
      params.set("conditions", `name~${trimmedFilter}`);
    }
    const raw = await getFilteredVroList<AttributeLink, ResourceElement>(
      this.http,
      "/resources",
      params,
      (item) => {
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
      },
      trimmedFilter,
      options?.limit,
    );
    return {
      ...(raw.total !== undefined ? { total: raw.total } : {}),
      start: raw.start,
      link: raw.link,
      ...(raw.truncated ? { truncated: true } : {}),
      ...(raw.limited ? { limited: true } : {}),
    };
  }

  async getResourceElement(id: string): Promise<ResourceElement> {
    const result = await this.listResources();
    const element = result.link.find((item) => item.id === id);
    if (!element) {
      if (result.truncated) {
        throw new Error(
          `Resource element ${id} was not found in the first ${result.link.length} resources, but the live resource list was truncated at the page-request cap, so it may exist beyond the returned page. Narrow the listing or retry rather than treating it as missing.`,
        );
      }
      throw new Error(`Resource element not found: ${id}`);
    }
    return element;
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
    const path = `/resources/${encodeURIComponent(id)}`;
    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] GET ${path}`);

    const res = await this.http.authenticatedFetch(
      url,
      { method: "GET", headers: { Accept: "*/*" } },
      { timeout: 60_000 },
    );
    if (!res.ok) {
      throw await this.http.apiError(res, "export resource");
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
    form: ReturnType<typeof createUploadForm>,
    changesetSha?: string,
  ): Promise<void> {
    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] POST ${path}`);

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (changesetSha) {
      headers["X-VRO-Changeset-Sha"] = changesetSha;
    }

    const res = await this.http.authenticatedFetch(
      url,
      { method: "POST", headers, body: form },
      { timeout: 60_000 },
    );
    if (!res.ok) {
      throw await this.http.apiError(res, `POST ${path}`);
    }
  }

  async importResource(categoryId: string, fileName: string): Promise<void> {
    const buffer = await this.readResourceFile(fileName);
    const form = createUploadForm(buffer, fileName);
    form.append("categoryId", categoryId);
    await this.postResourceForm("/resources", form);
  }

  async updateResourceContent(
    id: string,
    fileName: string,
    changesetSha?: string,
  ): Promise<void> {
    const path = `/resources/${encodeURIComponent(id)}`;
    const buffer = await this.readResourceFile(fileName);
    const form = createUploadForm(buffer, fileName);
    await this.postResourceForm(path, form, changesetSha);
  }

  async deleteResource(id: string, force = false): Promise<void> {
    const path = `/resources/${encodeURIComponent(id)}${force ? "?force=true" : ""}`;
    await this.http.del<unknown>(path);
  }
}
