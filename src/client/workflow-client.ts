import type {
  SimpleParameter,
  Workflow,
  WorkflowExecution,
  WorkflowExecutionList,
  WorkflowList,
} from "../types.js";
import { parseAttrs } from "./attrs.js";
import type { VroHttpClient } from "./core.js";

export class WorkflowClient {
  constructor(private http: VroHttpClient) {}

  async listWorkflows(filter?: string): Promise<WorkflowList> {
    let path = "/workflows";
    const params: string[] = [];
    if (filter) {
      params.push(`conditions=name~${encodeURIComponent(filter)}`);
    }
    if (params.length > 0) {
      path += `?${params.join("&")}`;
    }
    const raw = await this.http.get<{ link?: { attributes?: { name: string; value: string }[] }[]; total?: number }>(path);
    const link: Workflow[] = (raw.link ?? []).map((item) => {
      const a = parseAttrs(item.attributes);
      return {
        id: a["id"] ?? a["@id"],
        name: a["name"] ?? a["@name"],
        description: a["description"],
        version: a["version"],
        categoryId: a["categoryId"],
        categoryName: a["categoryName"],
      };
    });
    return { total: raw.total ?? link.length, link };
  }

  getWorkflow(id: string): Promise<Workflow> {
    return this.http.get<Workflow>(`/workflows/${encodeURIComponent(id)}`);
  }

  createWorkflow(
    categoryId: string,
    name: string,
    description?: string
  ): Promise<Workflow> {
    const body: Record<string, unknown> = {
      name,
      "category-id": categoryId,
    };
    if (description) {
      body.description = description;
    }
    return this.http.post<Workflow>("/workflows", body);
  }

  runWorkflow(
    id: string,
    inputs?: SimpleParameter[]
  ): Promise<WorkflowExecution> {
    const body: Record<string, unknown> = {};
    if (inputs && inputs.length > 0) {
      body.parameters = inputs.map((p) => ({
        name: p.name,
        type: p.type,
        value: { [p.type]: { value: p.value } },
      }));
    }
    return this.http.post<WorkflowExecution>(
      `/workflows/${encodeURIComponent(id)}/executions`,
      body
    );
  }

  getWorkflowExecution(
    workflowId: string,
    executionId: string
  ): Promise<WorkflowExecution> {
    return this.http.get<WorkflowExecution>(
      `/workflows/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(executionId)}`
    );
  }

  async listWorkflowExecutions(
    workflowId: string,
    options?: { maxResults?: number; status?: string }
  ): Promise<WorkflowExecutionList> {
    const params: string[] = [`maxResults=${options?.maxResults ?? 20}`];
    if (options?.status) {
      params.push(`conditions=state~${encodeURIComponent(options.status)}`);
    }
    const path = `/workflows/${encodeURIComponent(workflowId)}/executions?${params.join("&")}`;
    const raw = await this.http.get<{
      total?: number;
      relations?: { link?: { attributes?: { name: string; value: string }[] }[] };
    }>(path);
    const items = (raw.relations?.link ?? []).map((item) => {
      const a = parseAttrs(item.attributes);
      return {
        id: a["id"] ?? a["@id"] ?? "",
        state: a["state"] ?? "",
        "start-date": a["startDate"] ?? a["start-date"],
        "end-date": a["endDate"] ?? a["end-date"],
        "started-by": a["startedBy"] ?? a["started-by"],
      } as WorkflowExecution;
    });
    return { total: raw.total ?? items.length, relations: { link: items } };
  }

  async deleteWorkflow(id: string): Promise<void> {
    await this.http.del<unknown>(`/workflows/${encodeURIComponent(id)}`);
  }
}
