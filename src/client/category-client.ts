import type { Category, CategoryList } from "../types.js";
import { parseAttrs } from "./attrs.js";
import type { VroHttpClient } from "./core.js";

export class CategoryClient {
  constructor(private http: VroHttpClient) {}

  async listCategories(
    categoryType: string,
    filter?: string
  ): Promise<CategoryList> {
    let path = "/categories";
    const params: string[] = [`categoryType=${encodeURIComponent(categoryType)}`];
    if (filter) {
      params.push(`conditions=name~${encodeURIComponent(filter)}`);
    }
    path += `?${params.join("&")}`;
    const raw = await this.http.get<{ link?: { attributes?: { name: string; value: string }[] }[]; total?: number }>(path);
    const link: Category[] = (raw.link ?? []).map((item) => {
      const a = parseAttrs(item.attributes);
      return {
        id: a["id"] ?? a["@id"],
        name: a["name"] ?? a["@name"],
        description: a["description"],
        type: a["type"] ?? categoryType,
        path: a["path"],
      };
    });
    return { total: raw.total ?? link.length, link };
  }
}
