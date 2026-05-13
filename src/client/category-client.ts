import type { Category, CategoryList } from "../types.js";
import { parseAttrs } from "./attrs.js";
import type { VroHttpClient } from "./core.js";

export class CategoryClient {
  constructor(private http: VroHttpClient) {}

  async listCategories(
    categoryType: string,
    filter?: string,
  ): Promise<CategoryList> {
    let path = "/categories";
    const params: string[] = [
      `categoryType=${encodeURIComponent(categoryType)}`,
    ];
    if (filter) {
      params.push(`conditions=name~${encodeURIComponent(filter)}`);
    }
    path += `?${params.join("&")}`;
    const raw = await this.http.get<{
      link?: { attributes?: { name: string; value: string }[] }[];
      total?: number;
    }>(path);
    const link: Category[] = (raw.link ?? []).map((item) => {
      const a = parseAttrs(item.attributes);
      const category: Category = {
        id: a["id"] ?? a["@id"],
        name: a["name"] ?? a["@name"],
        description: a["description"],
        type: a["type"] ?? categoryType,
        path: a["path"],
        parentId:
          a["parentId"] ??
          a["parent-id"] ??
          a["parentCategoryId"] ??
          a["parent-category-id"],
        parentName:
          a["parentName"] ??
          a["parent-name"] ??
          a["parentCategoryName"] ??
          a["parent-category-name"],
        parentPath:
          a["parentPath"] ??
          a["parent-path"] ??
          a["parentCategoryPath"] ??
          a["parent-category-path"],
      };
      for (const key of ["parentId", "parentName", "parentPath"] as const) {
        if (category[key] === undefined) delete category[key];
      }
      return category;
    });
    return { total: raw.total ?? link.length, link };
  }
}
