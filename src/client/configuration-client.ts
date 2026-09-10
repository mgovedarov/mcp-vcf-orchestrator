import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import type { ConfigElement, ConfigElementList } from "../types.js";
import { parseAttrs } from "./attrs.js";
import {
  ensurePreflightPassed,
  preflightConfigurationFile,
  type ArtifactPreflightReport,
} from "./artifact-preflight.js";
import {
  createUploadForm,
  sanitizeErrorBody,
  UNSUPPORTED_VRA8_CONFIGURATION_EXPORT,
  type VroHttpClient,
} from "./core.js";
import {
  assertRealPathInside,
  getExistingFile,
  rejectSymlink,
  resolveFileInDirectory,
} from "./files.js";
import { getAllVroPages } from "./pagination.js";
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
    const params = new URLSearchParams();
    if (filter) {
      params.set("conditions", `name~${filter}`);
    }
    const raw = await getAllVroPages<{
      attributes?: { name: string; value: string }[];
    }>(this.http, "/configurations", params);
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
    return {
      total: raw.total ?? link.length,
      link,
      ...(raw.truncated ? { truncated: true } : {}),
    };
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
    // Asserted before the local file checks, like the import paths, so the
    // mode is reported without first touching the artifact directory.
    if (this.http.targetPlatform === "vra8") {
      throw new Error(UNSUPPORTED_VRA8_CONFIGURATION_EXPORT);
    }
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
        `vRO API error: ${res.status} ${res.statusText} — export configuration\n${sanitizeErrorBody(text, res)}${this.http.apiErrorHint(res)}`,
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
    const form = createUploadForm(buffer, fileName);
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
        `vRO API error: ${res.status} ${res.statusText} — import configuration\n${sanitizeErrorBody(text, res)}${this.http.apiErrorHint(res)}`,
      );
    }
  }

  /**
   * The request-body key carrying configuration attributes, which differs by
   * platform even though both return the plural `attributes` on reads:
   *
   * - VCFA 9.x accepts the singular `attribute`.
   * - vRA 8 requires the plural `attributes` and answers 400 for a body that
   *   carries `attribute` at all — including one that carries both keys, so a
   *   single body cannot satisfy both platforms (verified on vRO 8.18.1,
   *   VCFO-068).
   *
   * The `vcfa` branch keeps the key it already ships: whether VCFA 9.x also
   * accepts the plural form is unverified, so unifying on one key waits for a
   * 9.x lab check rather than being inferred from the response shape.
   */
  private attributeBodyKey(): "attribute" | "attributes" {
    return this.http.targetPlatform === "vra8" ? "attributes" : "attribute";
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
      body[this.attributeBodyKey()] = toVroParameters(attributes);
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

    // PUT /configurations/{id} replaces the element rather than patching it,
    // which has two consequences the caller does not ask for.
    //
    // First, vRA 8 rejects a body whose name is absent with `The configuration
    // element name contains invalid characters (\, /).Name: null` (verified on
    // vRO 8.18.1, VCFO-068), so the live name is carried forward when the
    // caller is not renaming — the way updateAction re-reads the current
    // action before its PUT.
    //
    // Second, a body that omits the attributes drops every attribute the
    // element had, which contradicts this method's contract that only the
    // provided fields change. Carrying them forward is not an option: a
    // SecureString attribute reads back as ciphertext with
    // `isPlainText: false`, so replaying a read value risks storing that blob
    // as the new secret. So an update that would silently clear attributes is
    // refused instead, and the caller re-sends the ones it wants to keep.
    //
    // One read serves both: it is skipped only for a call that renames and
    // sets attributes, and so needs neither.
    const needsLiveRead =
      params.name === undefined || params.attributes === undefined;
    const current = needsLiveRead ? await this.getConfiguration(id) : undefined;

    if (params.attributes === undefined) {
      const existing = current?.attributes ?? [];
      if (existing.length > 0) {
        // Names and types only — an attribute value is never echoed.
        const summary = existing
          .map((attribute) => `${attribute.name} (${attribute.type})`)
          .join(", ");
        throw new Error(
          `Updating configuration element ${id} replaces it, so omitting attributes would delete the ${existing.length} it currently has: ${summary}. Pass the attributes to keep (read them with get-configuration), or pass an empty array to clear them deliberately.`,
        );
      }
    }

    body.name = params.name ?? current?.name;
    if (params.description !== undefined) body.description = params.description;
    if (params.attributes !== undefined) {
      body[this.attributeBodyKey()] = toVroParameters(params.attributes);
    }
    await this.http.put<unknown>(
      `/configurations/${encodeURIComponent(id)}`,
      body,
    );
  }
}
