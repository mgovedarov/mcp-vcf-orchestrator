import type { Project, ProjectList } from "../types.js";
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
   * name and description; verified on vRA 8.18 under VCFO-065/072), so
   * `totalElements` and the truncation flag describe the matches and a
   * narrower search reaches projects beyond the page-request cap.
   *
   * VCFA 9.x has not yet been probed for `$filter` support. If the service
   * rejects the filter with a 400, the search falls back to the previous
   * behavior: walk the unfiltered list and match client-side.
   */
  async listProjects(search?: string): Promise<ProjectList> {
    const needle = normalizeFilter(search);
    if (!needle) return this.listAllProjects();

    const params = new URLSearchParams();
    params.set("$filter", projectSearchFilter(needle));
    try {
      return await getAllAutomationPages<Project>(
        this.http,
        "/projects",
        this.http.projectBaseUrl,
        params,
      );
    } catch (error) {
      if (apiErrorStatus(error) !== 400) throw error;
      console.error(
        "[vro-client] project-service rejected the $filter search with 400; matching name and description client-side instead",
      );
    }

    const page = await this.listAllProjects();
    const content = page.content.filter(
      (project) =>
        matchesFilter(project.name, needle) ||
        matchesFilter(project.description, needle),
    );
    return {
      content,
      numberOfElements: content.length,
      totalElements: content.length,
      ...(page.truncated ? { truncated: true } : {}),
    };
  }

  private listAllProjects(): Promise<ProjectList> {
    return getAllAutomationPages<Project>(
      this.http,
      "/projects",
      this.http.projectBaseUrl,
    );
  }

  getProject(id: string): Promise<Project> {
    return this.http.get<Project>(
      `/projects/${encodeURIComponent(id)}`,
      this.http.projectBaseUrl,
    );
  }
}
