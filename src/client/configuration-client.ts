import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import type { ConfigElement, ConfigElementList } from "../types.js";
import { parseAttrs } from "./attrs.js";
import {
  ensurePreflightPassed,
  preflightConfigurationFile,
  type ArtifactPreflightReport,
} from "./artifact-preflight.js";
import { sanitizeErrorBody, type VroHttpClient } from "./core.js";
import {
  assertRealPathInside,
  getExistingFile,
  rejectSymlink,
  resolveFileInDirectory,
} from "./files.js";
import { toVroParameters } from "./parameters.js";

export class ConfigurationClient {
  constructor(private http: VroHttpClient) {}

  async listConfigurations(
    filter?: string,
    categoryId?: string,
  ): Promise<ConfigElementList> {
    if (categoryId) {
      return this.listConfigurationsByCategory(categoryId, filter);
    }
    let path = "/configurations";
    const params: string[] = [];
    if (filter) {
      params.push(`conditions=name~${encodeURIComponent(filter)}`);
    }
    if (params.length > 0) {
      path += `?${params.join("&")}`;
    }
    const raw = await this.http.get<{
      link?: { attributes?: { name: string; value: string }[] }[];
      total?: number;
    }>(path);
    const link: ConfigElement[] = (raw.link ?? []).map((item) => {
      const a = parseAttrs(item.attributes);
      return {
        id: a["id"] ?? a["@id"],
        name: a["name"] ?? a["@name"],
        description: a["description"],
        version: a["version"],
        categoryId: a["categoryId"] ?? a["category-id"] ?? a["categoryid"],
      };
    });
    return { total: raw.total ?? link.length, link };
  }

  private async listConfigurationsByCategory(
    categoryId: string,
    filter?: string,
  ): Promise<ConfigElementList> {
    const raw = await this.http.get<{
      relations?: {
        link?: {
          rel?: string;
          href?: string;
          attributes?: { name: string; value: string }[];
        }[];
      };
    }>(`/categories/${encodeURIComponent(categoryId)}`);
    const links = raw.relations?.link ?? [];
    let link: ConfigElement[] = links.flatMap((l) => {
      if (l.rel !== "down") return [];
      const a = parseAttrs(l.attributes);
      const type = a["type"] ?? a["@type"] ?? a["@fullType"];
      if (type !== "ConfigurationElement") return [];
      return [{
        id: a["id"] ?? a["@id"],
        name: a["name"] ?? a["@name"],
        description: a["description"],
        version: a["version"],
        categoryId,
        href: l.href,
      }];
    });
    if (filter) {
      const lower = filter.toLowerCase();
      link = link.filter((item) => item.name?.toLowerCase().includes(lower) ?? false);
    }
    return { total: link.length, link };
  }

  getConfiguration(id: string): Promise<ConfigElement> {
    return this.http.get<ConfigElement>(
      `/configurations/${encodeURIComponent(id)}`,
    );
  }

  getConfigurationDirectory(): string {
    return this.http.configurationDir;
  }

  preflightConfigurationFile(
    fileName: string,
  ): Promise<ArtifactPreflightReport> {
    return preflightConfigurationFile(this.http.configurationDir, fileName);
  }

  private async resolveConfigurationPath(fileName: string): Promise<string> {
    const ext = extname(fileName).toLowerCase();
    if (ext !== ".vsoconf") {
      throw new Error("Configuration file name must end with .vsoconf");
    }
    return resolveFileInDirectory(
      this.http.configurationDir,
      fileName,
      "Configuration",
      "the configured configuration artifact directory",
    );
  }

  async exportConfigurationFile(
    id: string,
    fileName: string,
    overwrite = false,
  ): Promise<string> {
    const destPath = await this.resolveConfigurationPath(fileName);
    const existingFile = await getExistingFile(destPath);
    if (existingFile?.isSymbolicLink()) {
      throw new Error(
        "Configuration export target must not be a symbolic link",
      );
    }
    if (existingFile && !overwrite) {
      throw new Error(
        `Configuration file already exists: ${fileName}. Set overwrite to true to replace it.`,
      );
    }

    const path = `/configurations/${encodeURIComponent(id)}`;
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
        `vRO API error: ${res.status} ${res.statusText} — export configuration\n${sanitizeErrorBody(text, res)}`,
      );
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(destPath, buffer, { flag: overwrite ? "w" : "wx" });
    return destPath;
  }

  async importConfigurationFile(
    categoryId: string,
    fileName: string,
  ): Promise<void> {
    const path = "/configurations";
    this.http.assertOperationSupported("POST", path);
    ensurePreflightPassed(await this.preflightConfigurationFile(fileName));
    const srcPath = await this.resolveConfigurationPath(fileName);
    await rejectSymlink(
      srcPath,
      "Configuration import source must not be a symbolic link",
    );
    await assertRealPathInside(
      this.http.configurationDir,
      srcPath,
      "Configuration file path resolves outside the configured configuration artifact directory",
    );
    const buffer = await readFile(srcPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)]), fileName);
    form.append("categoryId", categoryId);

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
        `vRO API error: ${res.status} ${res.statusText} — import configuration\n${sanitizeErrorBody(text, res)}`,
      );
    }
  }

  createConfiguration(
    categoryId: string,
    name: string,
    description?: string,
    attributes?: { name: string; type: string; value?: string }[],
  ): Promise<ConfigElement> {
    const body: Record<string, unknown> = {
      name,
      "category-id": categoryId,
    };
    if (description) {
      body.description = description;
    }
    if (attributes && attributes.length > 0) {
      body.attribute = toVroParameters(attributes);
    }
    return this.http.post<ConfigElement>("/configurations", body);
  }

  async deleteConfiguration(id: string): Promise<void> {
    await this.http.del<unknown>(`/configurations/${encodeURIComponent(id)}`);
  }

  async updateConfiguration(
    id: string,
    params: {
      name?: string;
      description?: string;
      attributes?: { name: string; type: string; value?: string }[];
    },
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.description !== undefined) body.description = params.description;
    if (params.attributes !== undefined) {
      body.attribute = toVroParameters(params.attributes);
    }
    await this.http.put<unknown>(
      `/configurations/${encodeURIComponent(id)}`,
      body,
    );
  }
}
