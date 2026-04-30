import type { VroPlugin, VroPluginList } from "../types.js";
import { parseAttrs } from "./attrs.js";
import type { VroHttpClient } from "./core.js";

export class PluginClient {
  constructor(private http: VroHttpClient) {}

  async listPlugins(filter?: string): Promise<VroPluginList> {
    let path = "/plugins";
    if (filter) {
      path += `?conditions=name~${encodeURIComponent(filter)}`;
    }
    const raw = await this.http.get<{ link?: { attributes?: { name: string; value: string }[] }[]; total?: number }>(path);
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
