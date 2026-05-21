import type { Template, TemplateList } from "../types.js";
import type { VroHttpClient } from "./core.js";
import { getAllAutomationPages } from "./pagination.js";

export class TemplateClient {
  constructor(private http: VroHttpClient) {}

  listTemplates(search?: string, projectId?: string): Promise<TemplateList> {
    const params = new URLSearchParams();
    if (search) {
      params.set("$search", search);
    }
    if (projectId) {
      params.set("projectId", projectId);
    }
    return getAllAutomationPages<Template>(
      this.http,
      "/blueprints",
      this.http.blueprintBaseUrl,
      params,
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
