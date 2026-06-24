import type { Category, CategoryList } from "../types.js";
import { parseAttrs } from "./attrs.js";
import type { VroHttpClient } from "./core.js";
import { getAllVroPages } from "./pagination.js";

export class CategoryClient {
  constructor(private http: VroHttpClient) {}

  async listCategories(
    categoryType: string,
    filter?: string,
  ): Promise<CategoryList> {
    const params = new URLSearchParams();
    params.set("categoryType", categoryType);
    if (filter) {
      params.set("conditions", `name~${filter}`);
    }
    const raw = await getAllVroPages<{
      attributes?: { name: string; value: string }[];
    }>(this.http, "/categories", params);
    const link: Category[] = (raw.link ?? []).map((item) => {
      const a = parseAttrs(item.attributes);
      const category: Category = {
        // The "" fallbacks satisfy the required string type for malformed
        // entries that omit id/name, but they mask missing data — and an empty
        // id could collide with another malformed entry in downstream
        // find-by-id lookups. In practice live categories always carry both.
        id: a["id"] ?? a["@id"] ?? "",
        name: a["name"] ?? a["@name"] ?? "",
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
    return {
      total: raw.total ?? link.length,
      link,
      ...(raw.truncated ? { truncated: true } : {}),
    };
  }
}
