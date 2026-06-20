import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Action, ActionList, DiffActionFileParams } from "../types.js";
import { getLinkAttrs, type AttributeLink } from "./attrs.js";
import {
  diffActionArtifacts,
  ensurePreflightPassed,
  inspectActionArtifactBuffer,
  preflightActionFile,
  type ArtifactPreflightReport,
} from "./artifact-preflight.js";
import { sanitizeErrorBody, type VroHttpClient } from "./core.js";
import {
  assertRealPathInside,
  getExistingFile,
  rejectSymlink,
  resolveFileInDirectory,
} from "./files.js";
import { getAllVroPages } from "./pagination.js";

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("404") || error.message.includes("not found"))
  );
}

export interface ActionParameterInput {
  name: string;
  type: string;
  description?: string;
}

/**
 * Derives an action's module from a /actions list entry. That endpoint does not
 * return a `module` attribute — only `fqn`, which on vRO is `"<module>/<name>"`
 * (e.g. `com.vmware.library.snmp/createSnmpQuery`). Splitting on `.` truncates
 * the last module segment, so strip the known `name` suffix and split on the
 * `/` separator, tolerating a legacy dotted `"<module>.<name>"` form.
 */
function deriveActionModule(attrs: Record<string, string | undefined>): string {
  const direct = attrs["module"] ?? attrs["@module"];
  if (direct) return direct;
  const fqn = attrs["fqn"] ?? attrs["@fqn"];
  if (!fqn) return "";
  const name = attrs["name"] ?? attrs["@name"];
  if (name && fqn.endsWith(`/${name}`)) {
    return fqn.slice(0, -(name.length + 1));
  }
  if (fqn.includes("/")) {
    return fqn.slice(0, fqn.lastIndexOf("/"));
  }
  if (name && fqn.endsWith(`.${name}`)) {
    return fqn.slice(0, -(name.length + 1));
  }
  return fqn.split(".").slice(0, -1).join(".");
}

/**
 * Builds the vRO action JSON representation shared by create (POST /actions)
 * and update (PUT /actions/{id}). Keeping this in one place ensures the two
 * paths can never diverge in how they shape `output-type`/`input-parameters`.
 */
function buildActionBody(params: {
  id?: string;
  name: string;
  module: string;
  script: string;
  version?: string;
  returnType?: string;
  inputParameters?: ActionParameterInput[];
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: params.name,
    module: params.module,
    script: params.script,
  };
  if (params.id) {
    body["id"] = params.id;
  }
  if (params.version) {
    body["version"] = params.version;
  }
  if (params.returnType) {
    body["output-type"] = params.returnType;
  }
  if (params.inputParameters && params.inputParameters.length > 0) {
    body["input-parameters"] = params.inputParameters.map((p) => ({
      name: p.name,
      type: p.type,
      description: p.description ?? "",
    }));
  }
  return body;
}

export class ActionClient {
  constructor(private http: VroHttpClient) {}

  async listActions(filter?: string): Promise<ActionList> {
    // The vRO /actions endpoint ignores `conditions`/`maxResult` query params
    // (verified against vRO 9.1: it always returns the full list), so the name
    // filter must be applied client-side rather than relying on the server.
    const raw = await getAllVroPages<AttributeLink>(
      this.http,
      "/actions",
      new URLSearchParams(),
    );
    let link: Action[] = (raw.link ?? []).map((item) => {
      const a = getLinkAttrs(item);
      return {
        id: a["id"] ?? a["@id"],
        name: a["name"] ?? a["@name"],
        description: a["description"],
        module: deriveActionModule(a),
        version: a["version"],
        fqn: a["fqn"],
      };
    });
    if (filter) {
      const needle = filter.toLowerCase();
      link = link.filter((a) => (a.name ?? "").toLowerCase().includes(needle));
    }
    return {
      total: link.length,
      link,
      ...(raw.truncated ? { truncated: true } : {}),
    };
  }

  private parseActionReference(
    value: string,
  ): { moduleName: string; actionName: string } | null {
    const slashIndex = value.lastIndexOf("/");
    if (slashIndex > 0 && slashIndex < value.length - 1) {
      return {
        moduleName: value.slice(0, slashIndex),
        actionName: value.slice(slashIndex + 1),
      };
    }

    const dotIndex = value.lastIndexOf(".");
    if (dotIndex > 0 && dotIndex < value.length - 1) {
      return {
        moduleName: value.slice(0, dotIndex),
        actionName: value.slice(dotIndex + 1),
      };
    }

    return null;
  }

  private async resolveActionReference(id: string): Promise<{
    moduleName: string;
    actionName: string;
  }> {
    const parsed = this.parseActionReference(id);
    if (parsed) return parsed;

    const actions = await this.listActions();
    const action = actions.link.find(
      (item) => item.id === id || item.fqn === id,
    );
    if (!action) {
      throw new Error(`Action ${id} was not found`);
    }

    if (action.fqn) {
      const parsedFqn = this.parseActionReference(action.fqn);
      if (parsedFqn) return parsedFqn;
    }

    if (action.module && action.name) {
      return { moduleName: action.module, actionName: action.name };
    }

    throw new Error(`Action ${id} does not include module and name metadata`);
  }

  async getAction(id: string): Promise<Action> {
    if (!this.parseActionReference(id)) {
      try {
        return await this.http.get<Action>(
          `/actions/${encodeURIComponent(id)}`,
        );
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        // Older callers may pass friendly IDs that only resolve via list metadata.
      }
    }

    const { moduleName, actionName } = await this.resolveActionReference(id);
    return this.http.get<Action>(
      `/actions/${encodeURIComponent(moduleName)}/${encodeURIComponent(actionName)}`,
    );
  }

  getActionDirectory(): string {
    return this.http.actionDir;
  }

  preflightActionFile(fileName: string): Promise<ArtifactPreflightReport> {
    return preflightActionFile(this.http.actionDir, fileName);
  }

  private async resolveActionPath(fileName: string): Promise<string> {
    const ext = extname(fileName).toLowerCase();
    if (ext !== ".action") {
      throw new Error("Action file name must end with .action");
    }
    return resolveFileInDirectory(
      this.http.actionDir,
      fileName,
      "Action",
      "the configured action artifact directory",
    );
  }

  async exportActionFile(
    id: string,
    fileName: string,
    overwrite = false,
  ): Promise<string> {
    const destPath = await this.resolveActionPath(fileName);
    const existingFile = await getExistingFile(destPath);
    if (existingFile?.isSymbolicLink()) {
      throw new Error("Action export target must not be a symbolic link");
    }
    if (existingFile && !overwrite) {
      throw new Error(
        `Action file already exists: ${fileName}. Set overwrite to true to replace it.`,
      );
    }

    const buffer = await this.exportActionBuffer(id);
    await writeFile(destPath, buffer, { flag: overwrite ? "w" : "wx" });
    return destPath;
  }

  async exportActionBuffer(actionId: string): Promise<Buffer> {
    const path = `/actions/${encodeURIComponent(actionId)}`;
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
        `vRO API error: ${res.status} ${res.statusText} — export action\n${sanitizeErrorBody(text, res)}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async diffActionFile(params: DiffActionFileParams): Promise<string> {
    const base = await this.inspectActionDiffSource(params.base);
    const compare = await this.inspectActionDiffSource(params.compare);
    return diffActionArtifacts(base, compare);
  }

  private async inspectActionDiffSource(source: DiffActionFileParams["base"]) {
    if (source.source === "live") {
      return inspectActionArtifactBuffer(
        await this.exportActionBuffer(source.actionId),
        `live action ${source.actionId}`,
      );
    }

    const filePath = await this.resolveActionPath(source.fileName);
    await rejectSymlink(
      filePath,
      "Action diff source must not be a symbolic link",
    );
    await assertRealPathInside(
      this.http.actionDir,
      filePath,
      "Action file path resolves outside the configured action artifact directory",
    );
    return inspectActionArtifactBuffer(
      new Uint8Array(await readFile(filePath)),
      source.fileName,
    );
  }

  async importActionFile(
    categoryName: string,
    fileName: string,
  ): Promise<void> {
    const path = "/actions";
    this.http.assertOperationSupported("POST", path);
    ensurePreflightPassed(await this.preflightActionFile(fileName));
    const srcPath = await this.resolveActionPath(fileName);
    await rejectSymlink(
      srcPath,
      "Action import source must not be a symbolic link",
    );
    await assertRealPathInside(
      this.http.actionDir,
      srcPath,
      "Action file path resolves outside the configured action artifact directory",
    );
    const buffer = await readFile(srcPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)]), fileName);
    form.append("categoryName", categoryName);

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
        `vRO API error: ${res.status} ${res.statusText} — import action\n${sanitizeErrorBody(text, res)}`,
      );
    }
  }

  createAction(params: {
    moduleName: string;
    name: string;
    script: string;
    inputParameters?: ActionParameterInput[];
    returnType?: string;
  }): Promise<Action> {
    const body = buildActionBody({
      name: params.name,
      module: params.moduleName,
      script: params.script,
      returnType: params.returnType,
      inputParameters: params.inputParameters,
    });
    return this.http.post<Action>("/actions", body);
  }

  /**
   * Update an existing action in place. The current representation is fetched
   * first so unspecified fields (name, module, version, script, parameters,
   * return type) are preserved; only the provided fields are overlaid before
   * the whole representation is PUT back to /actions/{id}.
   */
  async updateAction(
    id: string,
    params: {
      script?: string;
      inputParameters?: ActionParameterInput[];
      returnType?: string;
      name?: string;
      moduleName?: string;
    },
  ): Promise<Action> {
    const current = await this.getAction(id);
    const actionId = current.id ?? id;
    const body = buildActionBody({
      id: actionId,
      name: params.name ?? current.name,
      module: params.moduleName ?? current.module,
      version: current.version,
      script: params.script ?? current.script ?? "",
      returnType: params.returnType ?? current["output-type"],
      inputParameters:
        params.inputParameters ??
        (current["input-parameters"] ?? []).map((p) => ({
          name: p.name,
          type: p.type,
          description: p.description,
        })),
    });
    // PUT returns a validation envelope ({ "errors": [] }) rather than the
    // updated action, so re-fetch to return the authoritative representation.
    await this.http.put<{ errors?: unknown[] }>(
      `/actions/${encodeURIComponent(actionId)}`,
      body,
    );
    return this.getAction(actionId);
  }

  async deleteAction(id: string): Promise<void> {
    await this.http.del<unknown>(`/actions/${encodeURIComponent(id)}`);
  }
}
