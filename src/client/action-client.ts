import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Action, ActionList } from "../types.js";
import { parseAttrs } from "./attrs.js";
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
    const raw = await this.http.get<{ link?: { attributes?: { name: string; value: string }[] }[]; total?: number }>(path);
    const link: Action[] = (raw.link ?? []).map((item) => {
      const a = parseAttrs(item.attributes);
      return {
        id: a["id"] ?? a["@id"],
        name: a["name"] ?? a["@name"],
        description: a["description"],
        module: a["module"] ?? a["fqn"]?.split(".").slice(0, -1).join(".") ?? "",
        version: a["version"],
        fqn: a["fqn"],
      };
    });
    return { total: raw.total ?? link.length, link };
  }

  getAction(id: string): Promise<Action> {
    return this.http.get<Action>(`/actions/${encodeURIComponent(id)}`);
  }

  getActionDirectory(): string {
    return this.http.actionDir;
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
      "VCFA_ACTION_DIR"
    );
  }

  async exportActionFile(
    id: string,
    fileName: string,
    overwrite = false
  ): Promise<string> {
    const destPath = await this.resolveActionPath(fileName);
    const existingFile = await getExistingFile(destPath);
    if (existingFile?.isSymbolicLink()) {
      throw new Error("Action export target must not be a symbolic link");
    }
    if (existingFile && !overwrite) {
      throw new Error(
        `Action file already exists: ${fileName}. Set overwrite to true to replace it.`
      );
    }

    const token = await this.http.ensureAuthenticated();
    const path = `/actions/${encodeURIComponent(id)}`;
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
      throw new Error(`vRO API error: ${res.status} ${res.statusText} — export action\n${text}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(destPath, buffer, { flag: overwrite ? "w" : "wx" });
    return destPath;
  }

  async importActionFile(categoryName: string, fileName: string): Promise<void> {
    const srcPath = await this.resolveActionPath(fileName);
    await rejectSymlink(srcPath, "Action import source must not be a symbolic link");
    await assertRealPathInside(
      this.http.actionDir,
      srcPath,
      "Action file path resolves outside VCFA_ACTION_DIR"
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
      throw new Error(`vRO API error: ${res.status} ${res.statusText} — import action\n${text}`);
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
