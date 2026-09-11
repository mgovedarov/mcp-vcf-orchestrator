import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import type { ConfigElement, ConfigElementList, ListOptions } from "../types.js";
import { matchesFilter, normalizeFilter } from "./filter.js";
import { parseAttrs } from "./attrs.js";
import {
  ensurePreflightPassed,
  preflightConfigurationFile,
  type ArtifactPreflightReport,
} from "./artifact-preflight.js";
import {
  createUploadForm,
  UNSUPPORTED_VRA8_CONFIGURATION_EXPORT,
  type VroHttpClient,
} from "./core.js";
import {
  assertRealPathInside,
  getExistingFile,
  rejectSymlink,
  resolveFileInDirectory,
} from "./files.js";
import { applyListLimit, getAllVroPages } from "./pagination.js";
import { toVroParameters } from "./parameters.js";

export class ConfigurationClient {
  constructor(private http: VroHttpClient) {}

  async listConfigurations(
    filter?: string,
    categoryId?: string,
    options?: ListOptions,
  ): Promise<ConfigElementList> {
    if (categoryId) {
      return this.listConfigurationsByCategory(categoryId, filter, options);
    }
    const params = new URLSearchParams();
    if (filter) {
      params.set("conditions", `name~${filter}`);
    }
    const raw = await getAllVroPages<{
      attributes?: { name: string; value: string }[];
    }>(this.http, "/configurations", params, { maxItems: options?.limit });
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
      ...(raw.total !== undefined ? { total: raw.total } : {}),
      link,
      ...(raw.truncated ? { truncated: true } : {}),
      ...(raw.limited ? { limited: true } : {}),
    };
  }

  private async listConfigurationsByCategory(
    categoryId: string,
    filter?: string,
    options?: ListOptions,
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
    const needle = normalizeFilter(filter);
    if (needle) {
      link = link.filter((item) => matchesFilter(item.name, needle));
    }
    const result = applyListLimit(link, options?.limit);
    return {
      total: result.total,
      link: result.items,
      ...(result.limited ? { limited: true } : {}),
    };
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
    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] GET ${path}`);

    const res = await this.http.authenticatedFetch(
      url,
      { method: "GET", headers: { Accept: "application/zip" } },
      { timeout: 60_000 },
    );
    if (!res.ok) {
      throw await this.http.apiError(res, "export configuration");
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
      throw await this.http.apiError(res, "import configuration");
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

  /**
   * Update a configuration element in place.
   *
   * `PUT /configurations/{id}` replaces the element rather than patching it,
   * so every field the caller does not supply is carried forward from the live
   * element — `current` when the caller has already read it (the tool handler
   * does, for its expected-name guard), otherwise one GET here — with a single
   * exception: attributes. A SecureString attribute reads back as ciphertext
   * with `isPlainText: false`, so replaying a read value risks storing that
   * blob as the new secret. An update that omits `attributes` on an element
   * that has some is therefore refused (see assertConfigurationUpdateSafe),
   * and the caller re-sends the ones it wants to keep.
   *
   * vRA 8 additionally rejects a body whose name is absent with `The
   * configuration element name contains invalid characters (\, /).Name: null`
   * (verified on vRO 8.18.1, VCFO-068), which the carry-forward also covers.
   */
  async updateConfiguration(
    id: string,
    params: ConfigurationUpdate,
    current?: ConfigElement,
  ): Promise<void> {
    const needsLiveRead =
      params.name === undefined ||
      params.description === undefined ||
      params.attributes === undefined;
    const live =
      current ?? (needsLiveRead ? await this.getConfiguration(id) : undefined);

    assertConfigurationUpdateSafe(id, live, params);

    const body: Record<string, unknown> = {};
    body.name = params.name ?? live?.name;
    const description = params.description ?? live?.description;
    if (description !== undefined) body.description = description;
    if (params.attributes !== undefined) {
      body[this.attributeBodyKey()] = toVroParameters(params.attributes);
    }
    await this.http.put<unknown>(
      `/configurations/${encodeURIComponent(id)}`,
      body,
    );
  }
}

/** The fields update-configuration may change; anything omitted is kept. */
export interface ConfigurationUpdate {
  name?: string;
  description?: string;
  attributes?: { name: string; type: string; value?: string }[];
}

/**
 * Detect secure/encrypted configuration attribute types whose values vRO never
 * returns in plaintext (e.g. `SecureString`). The `includes` checks are
 * defensive against any encrypted/secure variant the API reports. Mirrors the
 * redaction posture of the context-snapshot path.
 */
export function isSecureAttributeType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return t === "securestring" || t.includes("secure") || t.includes("encrypted");
}

/**
 * Refuse a configuration update that the replacing PUT would turn into data
 * loss the caller did not ask for. Pure, so the tool handler can run it in the
 * discovery phase — before `confirm: true` is spent — and the client runs it
 * again before the write.
 *
 * - Omitting `attributes` on an element that has some would delete them all.
 *   They are named (names and types only, never values) and the caller is told
 *   how to keep them. Plain values can be read back with get-configuration;
 *   secure values cannot, and must be supplied fresh.
 * - A secure-typed attribute supplied without a value would be stored as an
 *   empty secret, which is what a caller who copied a `[redacted]` listing
 *   would otherwise do by accident.
 */
export function assertConfigurationUpdateSafe(
  id: string,
  current: Pick<ConfigElement, "attributes"> | undefined,
  params: Pick<ConfigurationUpdate, "attributes">,
): void {
  if (params.attributes === undefined) {
    const existing = current?.attributes ?? [];
    if (existing.length === 0) return;
    const summary = existing
      .map((attribute) => `${attribute.name} (${attribute.type})`)
      .join(", ");
    const secure = existing.filter((attribute) =>
      isSecureAttributeType(attribute.type),
    );
    const secureNote =
      secure.length > 0
        ? ` Secure values (${secure.map((attribute) => attribute.name).join(", ")}) are never returned by get-configuration and must be supplied fresh.`
        : "";
    throw new Error(
      `Updating configuration element ${id} replaces it, so omitting attributes would delete the ${existing.length} it currently has: ${summary}. Pass the attributes to keep, or pass an empty array to clear them deliberately. Plain values can be read with get-configuration.${secureNote}`,
    );
  }

  const blankSecrets = params.attributes.filter(
    (attribute) => isSecureAttributeType(attribute.type) && !attribute.value,
  );
  if (blankSecrets.length > 0) {
    const names = blankSecrets.map((attribute) => attribute.name).join(", ");
    throw new Error(
      `Refusing to store an empty secret: secure attribute${blankSecrets.length === 1 ? "" : "s"} ${names} ${blankSecrets.length === 1 ? "was" : "were"} supplied without a value. Secure values cannot be read back from get-configuration, so supply the value to store, or leave the attribute out of the list to delete it deliberately.`,
    );
  }
}
