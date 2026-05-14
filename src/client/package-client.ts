import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import type {
  PackageExportOptions,
  PackageImportDetails,
  PackageImportOptions,
  ProjectPackageResult,
  VroPackage,
  VroPackageList,
} from "../types.js";
import { parseAttrs } from "./attrs.js";
import {
  ensurePreflightPassed,
  preflightPackageFile,
  type ArtifactPreflightReport,
} from "./artifact-preflight.js";
import { sanitizeErrorBody, type VroHttpClient } from "./core.js";
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
      workflows?: unknown[];
      actions?: unknown[];
      configurations?: unknown[];
      resources?: unknown[];
      usedPlugins?: unknown[];
      usedplugins?: unknown[];
      id?: string;
      href?: string;
      name?: string;
      description?: string;
    }>(`/packages/${encodeURIComponent(name)}`);
    const a = parseAttrs(raw.attributes);
    return {
      name: raw.name ?? a["name"] ?? name,
      description: raw.description ?? a["description"],
      version: a["version"],
      href: raw.href,
      workflows: raw.workflows,
      actions: raw.actions,
      configurations: raw.configurations,
      resources: raw.resources,
      usedPlugins: raw.usedPlugins ?? raw.usedplugins,
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

  resolveProjectPackageName(packageName?: string): string {
    const resolved = packageName ?? this.http.projectPackageName;
    if (!resolved) {
      throw new Error(
        "Project package name is required. Pass packageName or set VCFA_PROJECT_PACKAGE_NAME.",
      );
    }
    validatePackageName(resolved);
    return resolved;
  }

  async ensureProjectPackage(params: {
    packageName?: string;
    description?: string;
    createIfMissing?: boolean;
    confirm?: boolean;
  } = {}): Promise<ProjectPackageResult> {
    const name = this.resolveProjectPackageName(params.packageName);
    const existing = await this.tryGetPackage(name);
    if (existing) {
      return { name, created: false, package: existing };
    }

    if (!params.createIfMissing || !params.confirm) {
      throw new Error(
        `Package '${name}' was not found. Reuse requires an existing package; set createIfMissing and confirm to true to create this exact project package.`,
      );
    }

    await this.putPackage(
      name,
      params.description ?? this.http.projectPackageDescription,
    );
    return { name, created: true };
  }

  async createPackage(
    name: string,
    description?: string,
    items?: {
      workflows?: string[];
      actions?: string[];
      resources?: string[];
      configurations?: string[];
    },
  ): Promise<void> {
    validatePackageName(name);
    const existing = await this.tryGetPackage(name);
    if (existing) {
      throw new Error(
        `Package '${name}' already exists. Reuse the existing package instead of creating a new one.`,
      );
    }
    await this.putPackage(name, description, items);
  }

  async rebuildPackage(name: string): Promise<void> {
    validatePackageName(name);
    await this.http.post<unknown>(
      `/packages/${encodeURIComponent(name)}/rebuild`,
      {},
    );
  }

  async addWorkflowToPackage(packageName: string, workflowId: string): Promise<void> {
    validatePackageName(packageName);
    await this.http.post<unknown>(
      `/packages/${encodeURIComponent(packageName)}/workflow/${encodeURIComponent(workflowId)}`,
      {},
    );
  }

  async addActionToPackage(
    packageName: string,
    categoryName: string,
    actionName: string,
  ): Promise<void> {
    validatePackageName(packageName);
    await this.http.post<unknown>(
      `/packages/${encodeURIComponent(packageName)}/action/${encodeURIComponent(categoryName)}/${encodeURIComponent(actionName)}`,
      {},
    );
  }

  async addConfigurationToPackage(
    packageName: string,
    configurationId: string,
  ): Promise<void> {
    validatePackageName(packageName);
    await this.http.post<unknown>(
      `/packages/${encodeURIComponent(packageName)}/configuration/${encodeURIComponent(configurationId)}`,
      {},
    );
  }

  async addResourceToPackage(
    packageName: string,
    resourceId: string,
  ): Promise<void> {
    validatePackageName(packageName);
    await this.http.post<unknown>(
      `/packages/${encodeURIComponent(packageName)}/resource/${encodeURIComponent(resourceId)}`,
      {},
    );
  }

  async exportPackage(
    name: string,
    fileName: string,
    overwrite = false,
    options: PackageExportOptions = {},
  ): Promise<string> {
    validatePackageName(name);
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
    const query = packageExportQuery(options);
    const path = `/content/packages/${encodeURIComponent(name)}${query}`;
    this.http.assertOperationSupported("GET", path);
    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] GET ${path}`);

    const res = await this.http.authenticatedFetch(
      url,
      { method: "GET", headers: { Accept: "application/zip" } },
      { timeout: 60_000 },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vRO API error: ${res.status} ${res.statusText} — export package\n${sanitizeErrorBody(text, res)}`,
      );
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(destPath, buffer, { flag: overwrite ? "w" : "wx" });
    return destPath;
  }

  async importPackage(fileName: string, overwrite = true): Promise<void> {
    await this.importPackageWithOptions(fileName, { overwrite });
  }

  async importPackageWithOptions(
    fileName: string,
    options: PackageImportOptions = {},
  ): Promise<void> {
    const query = packageImportQuery(options);
    const path = `/packages${query}`;
    this.http.assertOperationSupported("POST", path);
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
    const buffer = await readFile(srcPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)]), fileName);
    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] POST ${path}`);

    const res = await this.http.authenticatedFetch(
      url,
      { method: "POST", headers: { Accept: "application/json" }, body: form },
      { timeout: 60_000 },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vRO API error: ${res.status} ${res.statusText} — import package\n${sanitizeErrorBody(text, res)}`,
      );
    }
  }

  async getPackageImportDetails(fileName: string): Promise<PackageImportDetails> {
    const path = "/packages/import-details";
    this.http.assertOperationSupported("POST", path);
    ensurePreflightPassed(await this.preflightPackageFile(fileName));
    const srcPath = await this.resolvePackagePath(fileName);
    await rejectSymlink(
      srcPath,
      "Package import details source must not be a symbolic link",
    );
    await assertRealPathInside(
      this.http.packageDir,
      srcPath,
      "Package file path resolves outside the configured package artifact directory",
    );
    const buffer = await readFile(srcPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)]), fileName);
    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] POST ${path}`);

    const res = await this.http.authenticatedFetch(
      url,
      { method: "POST", headers: { Accept: "application/json" }, body: form },
      { timeout: 60_000 },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vRO API error: ${res.status} ${res.statusText} — package import details\n${sanitizeErrorBody(text, res)}`,
      );
    }
    return (await res.json()) as PackageImportDetails;
  }

  async deletePackage(name: string, deleteContents = false): Promise<void> {
    validatePackageName(name);
    const option = deleteContents
      ? "deletePackageWithContent"
      : "deletePackage";
    await this.http.del<unknown>(
      `/packages/${encodeURIComponent(name)}?option=${option}`,
    );
  }

  private async tryGetPackage(name: string): Promise<VroPackage | null> {
    try {
      return await this.getPackage(name);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("404") || error.message.includes("not found"))
      ) {
        return null;
      }
      throw error;
    }
  }

  private async putPackage(
    name: string,
    description?: string,
    items?: {
      workflows?: string[];
      actions?: string[];
      resources?: string[];
      configurations?: string[];
    },
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (description) body.description = description;
    if (items) body.items = items;
    await this.http.put<unknown>(`/packages/${encodeURIComponent(name)}`, body);
  }
}

function validatePackageName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(name)) {
    throw new Error(
      `Package name '${name}' must be fully qualified, for example com.example.project.`,
    );
  }
}

function packageExportQuery(options: PackageExportOptions): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function packageImportQuery(options: PackageImportOptions): string {
  const params = new URLSearchParams();
  params.set("overwrite", String(options.overwrite ?? true));
  if (options.importConfigurationAttributeValues !== undefined) {
    params.set(
      "importConfigurationAttributeValues",
      String(options.importConfigurationAttributeValues),
    );
  }
  if (options.tagImportMode !== undefined) {
    params.set("tagImportMode", options.tagImportMode);
  }
  if (options.importConfigSecureStringAttributeValues !== undefined) {
    params.set(
      "importConfigSecureStringAttributeValues",
      String(options.importConfigSecureStringAttributeValues),
    );
  }
  return `?${params.toString()}`;
}
