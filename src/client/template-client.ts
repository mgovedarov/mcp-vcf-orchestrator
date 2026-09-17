import type { ListOptions, Template, TemplateList } from "../types.js";
import type { VroHttpClient } from "./core.js";
import { matchesNameOrDescription } from "./filter.js";
import { getFilteredAutomationList } from "./pagination.js";

export class TemplateClient {
  constructor(private http: VroHttpClient) {}

  listTemplates(search?: string, projectId?: string, options?: ListOptions): Promise<TemplateList> {
    const params = new URLSearchParams();
    // Trimmed so the server-side query and the client-side needle agree on
    // what counts as a filter: a blank one is neither sent nor matched, and a
    // padded one selects the same rows on both. See getFilteredAutomationList.
    const trimmedSearch = search?.trim();
    if (trimmedSearch) {
      params.set("$search", trimmedSearch);
    }
    if (projectId) {
      params.set("projectId", projectId);
    }
    return getFilteredAutomationList<Template>(
      this.http,
      "/blueprints",
      this.http.blueprintBaseUrl,
      params,
      matchesNameOrDescription,
      trimmedSearch,
      options?.limit,
    );
  }

  getTemplate(id: string): Promise<Template> {
    return this.http.get<Template>(
      `/blueprints/${encodeURIComponent(id)}`,
      this.http.blueprintBaseUrl,
    );
  }

  createTemplate(params: {
    name: string;
    projectId: string;
    description?: string;
    content?: string;
    requestScopeOrg?: boolean;
  }): Promise<Template> {
    const body: Record<string, unknown> = {
      name: params.name,
      projectId: params.projectId,
    };
    if (params.description !== undefined) body.description = params.description;
    if (params.content !== undefined) body.content = params.content;
    if (params.requestScopeOrg !== undefined)
      body.requestScopeOrg = params.requestScopeOrg;
    return this.http.post<Template>(
      "/blueprints",
      body,
      this.http.blueprintBaseUrl,
    );
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.http.del<unknown>(
      `/blueprints/${encodeURIComponent(id)}`,
      this.http.blueprintBaseUrl,
    );
  }
}
