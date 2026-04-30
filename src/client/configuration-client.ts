import type { ConfigElement, ConfigElementList } from "../types.js";
import { parseAttrs } from "./attrs.js";
import type { VroHttpClient } from "./core.js";
import { toVroParameters } from "./parameters.js";

export class ConfigurationClient {
  constructor(private http: VroHttpClient) {}

  async listConfigurations(filter?: string): Promise<ConfigElementList> {
    let path = "/configurations";
    const params: string[] = [];
    if (filter) {
      params.push(`conditions=name~${encodeURIComponent(filter)}`);
    }
    if (params.length > 0) {
      path += `?${params.join("&")}`;
    }
    const raw = await this.http.get<{ link?: { attributes?: { name: string; value: string }[] }[]; total?: number }>(path);
    const link: ConfigElement[] = (raw.link ?? []).map((item) => {
      const a = parseAttrs(item.attributes);
      return {
        id: a["id"] ?? a["@id"],
        name: a["name"] ?? a["@name"],
        description: a["description"],
        version: a["version"],
        categoryId: a["categoryId"],
      };
    });
    return { total: raw.total ?? link.length, link };
  }

  getConfiguration(id: string): Promise<ConfigElement> {
    return this.http.get<ConfigElement>(
      `/configurations/${encodeURIComponent(id)}`
    );
  }

  createConfiguration(
    categoryId: string,
    name: string,
    description?: string,
    attributes?: { name: string; type: string; value?: string }[]
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
    }
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.description !== undefined) body.description = params.description;
    if (params.attributes !== undefined) {
      body.attribute = toVroParameters(params.attributes);
    }
    await this.http.put<unknown>(`/configurations/${encodeURIComponent(id)}`, body);
  }
}
