import type { ListOptions, Template, TemplateList } from "../types.js";
import {
  apiErrorStatus,
  TEMPLATE_CREATE_CONTENT_REQUIRED,
  type VroHttpClient,
} from "./core.js";
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

  /**
   * Creates a blueprint. `content` stays optional on the wire — vRA 8 creates
   * an empty template from a request without it (VCFO-070) — but VCF
   * Automation 9.1 refuses that request with an opaque 400, so the two facts
   * are reconciled by asking the server and explaining its answer rather than
   * by refusing pre-emptively. See TEMPLATE_CREATE_CONTENT_REQUIRED.
   */
  async createTemplate(params: {
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
    try {
      return await this.http.post<Template>(
        "/blueprints",
        body,
        this.http.blueprintBaseUrl,
      );
    } catch (error) {
      if (params.content === undefined && apiErrorStatus(error) === 400) {
        const message = (error as Error).message;
        throw Object.assign(
          new Error(`${message}${TEMPLATE_CREATE_CONTENT_REQUIRED}`),
          { status: 400 },
        );
      }
      throw error;
    }
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.http.del<unknown>(
      `/blueprints/${encodeURIComponent(id)}`,
      this.http.blueprintBaseUrl,
    );
  }
}
