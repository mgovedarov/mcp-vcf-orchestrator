import type { ListOptions, Project, ProjectList } from "../types.js";
import { matchesFilter, normalizeFilter } from "./filter.js";
import { apiErrorStatus, type VroHttpClient } from "./core.js";
import { getAllAutomationPages } from "./pagination.js";

/**
 * OData `$filter` for a case-insensitive substring search on project name and
 * description. `substringof` alone is case-sensitive on the project-service,
 * so both fields go through `tolower()` and the needle is expected already
 * lower-cased (see normalizeFilter). A single quote inside an OData string
 * literal is escaped by doubling it.
 */
export function projectSearchFilter(needle: string): string {
  const literal = needle.replace(/'/g, "''");
  return `substringof('${literal}', tolower(name)) or substringof('${literal}', tolower(description))`;
}

export class ProjectClient {
  constructor(private http: VroHttpClient) {}

  /**
   * List projects from the project-service API. The optional search is sent
   * server-side as an OData `$filter` (case-insensitive substring match on
   * name and description), so `totalElements` and the truncation flag describe
   * the matches and a narrower search reaches projects beyond the page-request
   * cap.
   *
   * Both platforms accept the filter *and apply it*, verified under VCFO-065
   * by asking for a needle that matches nothing and getting an empty page
   * rather than the full inventory: vRA 8.18 under VCFO-072, VCF Automation
   * 9.1 on a tenant session. Description matching is confirmed on 9.1, where a
   * project carries a non-empty description.
   *
   * The fallback remains for a platform that supports neither `substringof`
   * nor `tolower`. Neither lab is that platform, so the trigger is both of the
   * statuses a filter the service cannot satisfy earns on the ones we have:
   * the 400 a malformed filter earns on either, and the 500 both answer for an
   * element of the filter expression they do not know — an unknown field,
   * which is the nearest observable stand-in for an unknown operator. It stays
   * those two: a 401 — and, on `vcfa`, a JSON 403 — has to reach the
   * re-authenticate-and-retry path in `core.ts` first, and an authorization
   * denial is not something a second, unfiltered walk could improve on.
   * The status is logged because a transient 500 now costs a full-inventory
   * walk instead of surfacing — and if the service is genuinely down, that
   * walk fails too and reports it.
   */
  async listProjects(search?: string, options?: ListOptions): Promise<ProjectList> {
    const needle = normalizeFilter(search);
    if (!needle) return this.listAllProjects(options);

    const params = new URLSearchParams();
    params.set("$filter", projectSearchFilter(needle));
    try {
      return await getAllAutomationPages<Project>(
        this.http,
        "/projects",
        this.http.projectBaseUrl,
        params,
        { maxItems: options?.limit },
      );
    } catch (error) {
      const status = apiErrorStatus(error);
      if (status !== 400 && status !== 500) throw error;
      console.error(
        `[vro-client] project-service rejected the $filter search with ${status}; matching name and description client-side instead`,
      );
    }

    const matches = (project: Project) =>
        matchesFilter(project.name, needle) ||
        matchesFilter(project.description, needle);
    if (options?.limit !== undefined) {
      return getAllAutomationPages<Project>(
        this.http,
        "/projects",
        this.http.projectBaseUrl,
        undefined,
        { maxItems: options.limit, itemFilter: matches },
      );
    }
    const page = await this.listAllProjects();
    const content = page.content.filter(matches);
    return {
      content,
      numberOfElements: content.length,
      totalElements: content.length,
      ...(page.truncated ? { truncated: true } : {}),
    };
  }

  private listAllProjects(options?: ListOptions): Promise<ProjectList> {
    return getAllAutomationPages<Project>(
      this.http,
      "/projects",
      this.http.projectBaseUrl,
      undefined,
      { maxItems: options?.limit },
    );
  }

  getProject(id: string): Promise<Project> {
    return this.http.get<Project>(
      `/projects/${encodeURIComponent(id)}`,
      this.http.projectBaseUrl,
    );
  }
}
