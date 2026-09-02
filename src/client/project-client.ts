import type { Project, ProjectList } from "../types.js";
import type { VroHttpClient } from "./core.js";
import { getAllAutomationPages } from "./pagination.js";

export class ProjectClient {
  constructor(private http: VroHttpClient) {}

  /**
   * List projects from the project-service API. The optional search is a
   * client-side, case-insensitive substring match on name and description
   * applied after full pagination; the wire request carries no filter.
   */
  async listProjects(search?: string): Promise<ProjectList> {
    const page = await getAllAutomationPages<Project>(
      this.http,
      "/projects",
      this.http.projectBaseUrl,
    );
    const needle = search?.trim().toLowerCase();
    if (!needle) return page;
    const content = page.content.filter(
      (project) =>
        project.name?.toLowerCase().includes(needle) ||
        project.description?.toLowerCase().includes(needle),
    );
    const filtered: ProjectList = {
      content,
      numberOfElements: content.length,
      totalElements: content.length,
    };
    if (page.truncated) filtered.truncated = true;
    return filtered;
  }

  getProject(id: string): Promise<Project> {
    return this.http.get<Project>(
      `/projects/${encodeURIComponent(id)}`,
      this.http.projectBaseUrl,
    );
  }
}
