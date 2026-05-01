import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import type { VroPackage, VroPackageList } from "../types.js";
import { parseAttrs } from "./attrs.js";
import {
  ensurePreflightPassed,
  preflightPackageFile,
  type ArtifactPreflightReport,
} from "./artifact-preflight.js";
import type { VroHttpClient } from "./core.js";
import {
  assertRealPathInside,
  getExistingFile,
  rejectSymlink,
  resolveFileInDirectory,
} from "./files.js";

export class PackageClient {
  constructor(private http: VroHttpClient) {}

  async listPackages(filter?: string): Promise<VroPackageList> {
    let path = "/packages";
    if (filter) {
      path += `?conditions=name~${encodeURIComponent(filter)}`;
    }
    const raw = await this.http.get<{
      link?: { attributes?: { name: string; value: string }[] }[];
      total?: number;
    }>(path);
    const link: VroPackage[] = (raw.link ?? []).map((item) => {
      const a = parseAttrs(item.attributes);
      return {
        name: a["name"] ?? a["@name"],
        description: a["description"],
        version: a["version"],
      };
    });
    return { total: raw.total ?? link.length, link };
  }

  async getPackage(name: string): Promise<VroPackage> {
    const raw = await this.http.get<{
      attributes?: { name: string; value: string }[];
    }>(`/packages/${encodeURIComponent(name)}`);
    const a = parseAttrs(raw.attributes);
    return {
      name: a["name"] ?? name,
      description: a["description"],
      version: a["version"],
    };
  }

  getPackageDirectory(): string {
    return this.http.packageDir;
  }

  preflightPackageFile(fileName: string): Promise<ArtifactPreflightReport> {
    return preflightPackageFile(this.http.packageDir, fileName);
  }

  private async resolvePackagePath(fileName: string): Promise<string> {
    const ext = extname(fileName).toLowerCase();
    if (ext !== ".package" && ext !== ".zip") {
      throw new Error("Package file name must end with .package or .zip");
    }
    return resolveFileInDirectory(
      this.http.packageDir,
      fileName,
      "Package",
      "the configured package artifact directory",
    );
  }

  async exportPackage(
    name: string,
    fileName: string,
    overwrite = false,
  ): Promise<string> {
    const destPath = await this.resolvePackagePath(fileName);
    const existingFile = await getExistingFile(destPath);
    if (existingFile?.isSymbolicLink()) {
      throw new Error("Package export target must not be a symbolic link");
    }
    if (existingFile && !overwrite) {
      throw new Error(
        `Package file already exists: ${fileName}. Set overwrite to true to replace it.`,
      );
    }
    const token = await this.http.ensureAuthenticated();
    const url = `${this.http.baseUrl}/packages/${encodeURIComponent(name)}?export=true`;
    console.error(`[vro-client] GET /packages/${name}?export=true`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/zip",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vRO API error: ${res.status} ${res.statusText} — export package\n${text}`,
      );
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(destPath, buffer, { flag: overwrite ? "w" : "wx" });
    return destPath;
  }

  async importPackage(fileName: string, overwrite = true): Promise<void> {
    ensurePreflightPassed(await this.preflightPackageFile(fileName));
    const srcPath = await this.resolvePackagePath(fileName);
    await rejectSymlink(
      srcPath,
      "Package import source must not be a symbolic link",
    );
    await assertRealPathInside(
      this.http.packageDir,
      srcPath,
      "Package file path resolves outside the configured package artifact directory",
    );
    const token = await this.http.ensureAuthenticated();
    const buffer = await readFile(srcPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)]), fileName);
    const url = `${this.http.baseUrl}/packages?overwrite=${overwrite}`;
    console.error(`[vro-client] POST /packages?overwrite=${overwrite}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vRO API error: ${res.status} ${res.statusText} — import package\n${text}`,
      );
    }
  }

  async deletePackage(name: string, deleteContents = false): Promise<void> {
    const option = deleteContents
      ? "deletePackageWithContent"
      : "deletePackage";
    await this.http.del<unknown>(
      `/packages/${encodeURIComponent(name)}?option=${option}`,
    );
  }
}
