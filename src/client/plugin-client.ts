import type { VroPlugin, VroPluginList } from "../types.js";
import { parseAttrs } from "./attrs.js";
import type { VroHttpClient } from "./core.js";
import { getAllVroPages } from "./pagination.js";

export class PluginClient {
  constructor(private http: VroHttpClient) {}

  async listPlugins(filter?: string): Promise<VroPluginList> {
    const params = new URLSearchParams();
    if (filter) {
      params.set("conditions", `name~${filter}`);
    }
    const raw = await getAllVroPages<{
      attributes?: { name: string; value: string }[];
    }>(this.http, "/plugins", params);
    const link: VroPlugin[] = (raw.link ?? []).map((item) => {
      const a = parseAttrs(item.attributes);
      return {
        name: a["name"] ?? a["@name"] ?? "",
        displayName: a["displayName"] ?? a["display-name"],
        version: a["version"],
        description: a["description"],
        type: a["type"],
      };
    });
    return { total: raw.total ?? link.length, link };
  }
}
