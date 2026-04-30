import type { Action, ActionList } from "../types.js";
import { parseAttrs } from "./attrs.js";
import type { VroHttpClient } from "./core.js";

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
