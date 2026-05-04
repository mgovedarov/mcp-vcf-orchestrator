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
import type { VroHttpClient } from "./core.js";
import {
  assertRealPathInside,
  getExistingFile,
  rejectSymlink,
  resolveFileInDirectory,
} from "./files.js";

export class ActionClient {
  constructor(private http: VroHttpClient) {}

  async listActions(filter?: string): Promise<ActionList> {
    let path = "/actions";
    const params: string[] = [];
    if (filter) {
      params.push(`conditions=name~${encodeURIComponent(filter)}`);
    }
    if (params.length > 0) {
      path += `?${params.join("&")}`;
    }
    const raw = await this.http.get<{ link?: AttributeLink[]; total?: number }>(
      path,
    );
    const link: Action[] = (raw.link ?? []).map((item) => {
      const a = getLinkAttrs(item);
      return {
        id: a["id"] ?? a["@id"],
        name: a["name"] ?? a["@name"],
        description: a["description"],
        module:
          a["module"] ?? a["fqn"]?.split(".").slice(0, -1).join(".") ?? "",
        version: a["version"],
        fqn: a["fqn"],
      };
    });
    return { total: raw.total ?? link.length, link };
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
      } catch {
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
    const token = await this.http.ensureAuthenticated();
    const path = `/actions/${encodeURIComponent(actionId)}`;
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
        `vRO API error: ${res.status} ${res.statusText} — export action\n${text}`,
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
    const token = await this.http.ensureAuthenticated();
    const buffer = await readFile(srcPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)]), fileName);
    form.append("categoryName", categoryName);

    const path = "/actions";
    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] POST ${path}`);

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
        `vRO API error: ${res.status} ${res.statusText} — import action\n${text}`,
      );
    }
  }

  createAction(params: {
    moduleName: string;
    name: string;
    script: string;
    inputParameters?: { name: string; type: string; description?: string }[];
    returnType?: string;
  }): Promise<Action> {
    const body: Record<string, unknown> = {
      name: params.name,
      module: params.moduleName,
      script: params.script,
    };
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
    return this.http.post<Action>("/actions", body);
  }

  async deleteAction(id: string): Promise<void> {
    await this.http.del<unknown>(`/actions/${encodeURIComponent(id)}`);
  }
}
