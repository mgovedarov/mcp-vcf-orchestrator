import type { Category, CategoryList, ListOptions } from "../types.js";
import { parseAttrs } from "./attrs.js";
import type { VroHttpClient } from "./core.js";
import { getFilteredVroList } from "./pagination.js";

export class CategoryClient {
  constructor(private http: VroHttpClient) {}

  async listCategories(
    categoryType: string,
    filter?: string,
    options?: ListOptions,
  ): Promise<CategoryList> {
    const params = new URLSearchParams();
    params.set("categoryType", categoryType);
    // Trimmed so the server-side query and the client-side needle agree on
    // what counts as a filter: a blank one is neither sent nor matched, and a
    // padded one selects the same names on both. See getFilteredVroList.
    const trimmedFilter = filter?.trim();
    if (trimmedFilter) {
      params.set("conditions", `name~${trimmedFilter}`);
    }
    const raw = await getFilteredVroList<
      { attributes?: { name: string; value: string }[] },
      Category
    >(
      this.http,
      "/categories",
      params,
      (item) => {
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
      },
      trimmedFilter,
      options?.limit,
    );
    return {
      ...(raw.total !== undefined ? { total: raw.total } : {}),
      link: raw.link,
      ...(raw.truncated ? { truncated: true } : {}),
      ...(raw.limited ? { limited: true } : {}),
    };
  }
}
