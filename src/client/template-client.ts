import type { Template, TemplateList } from "../types.js";
import type { VroHttpClient } from "./core.js";

export class TemplateClient {
  constructor(private http: VroHttpClient) {}

  listTemplates(search?: string, projectId?: string): Promise<TemplateList> {
    const params: string[] = [];
    if (search) {
      params.push(`$search=${encodeURIComponent(search)}`);
    }
    if (projectId) {
      params.push(`projectId=${encodeURIComponent(projectId)}`);
    }
    const path =
      params.length > 0 ? `/blueprints?${params.join("&")}` : "/blueprints";
    return this.http.get<TemplateList>(path, this.http.blueprintBaseUrl);
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
