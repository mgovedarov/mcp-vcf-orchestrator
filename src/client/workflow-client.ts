import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import type {
  ScaffoldWorkflowFileParams,
  SimpleParameter,
  Workflow,
  WorkflowExecution,
  WorkflowExecutionList,
  WorkflowExecutionLogs,
  WorkflowList,
} from "../types.js";
import { parseAttrs } from "./attrs.js";
import type { VroHttpClient } from "./core.js";
import {
  assertRealPathInside,
  getExistingFile,
  rejectSymlink,
  resolveFileInDirectory,
} from "./files.js";
import { buildWorkflowArtifact } from "./workflow-artifact.js";

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
    const raw = await this.http.get<{
      link?: { attributes?: { name: string; value: string }[] }[];
      total?: number;
    }>(path);
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
    description?: string,
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
    inputs?: SimpleParameter[],
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
      body,
    );
  }

  getWorkflowExecution(
    workflowId: string,
    executionId: string,
    options?: { showDetails?: boolean },
  ): Promise<WorkflowExecution> {
    const params: string[] = [];
    if (options?.showDetails) {
      params.push("showDetails=true");
    }
    const query = params.length > 0 ? `?${params.join("&")}` : "";
    return this.http.get<WorkflowExecution>(
      `/workflows/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(executionId)}${query}`,
    );
  }

  getWorkflowExecutionLogs(
    workflowId: string,
    executionId: string,
    options?: { maxResult?: number },
  ): Promise<WorkflowExecutionLogs> {
    const params: string[] = [];
    if (options?.maxResult !== undefined) {
      params.push(`maxResult=${options.maxResult}`);
    }
    const query = params.length > 0 ? `?${params.join("&")}` : "";
    return this.http.get<WorkflowExecutionLogs>(
      `/workflows/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(executionId)}/logs${query}`,
    );
  }

  async listWorkflowExecutions(
    workflowId: string,
    options?: { maxResults?: number; status?: string },
  ): Promise<WorkflowExecutionList> {
    const params: string[] = [`maxResults=${options?.maxResults ?? 20}`];
    if (options?.status) {
      params.push(`conditions=state~${encodeURIComponent(options.status)}`);
    }
    const path = `/workflows/${encodeURIComponent(workflowId)}/executions?${params.join("&")}`;
    const raw = await this.http.get<{
      total?: number;
      relations?: {
        total?: number;
        link?: { attributes?: { name: string; value: string }[] }[];
      };
    }>(path);
    const items = (raw.relations?.link ?? [])
      .map((item) => {
        const a = parseAttrs(item.attributes);
        return {
          id: a["id"] ?? a["@id"] ?? "",
          state: a["state"] ?? "",
          "start-date": a["startDate"] ?? a["start-date"],
          "end-date": a["endDate"] ?? a["end-date"],
          "started-by": a["startedBy"] ?? a["started-by"],
        } as WorkflowExecution;
      })
      .filter((item) => item.id);
    return {
      total: raw.total ?? raw.relations?.total ?? items.length,
      relations: { link: items },
    };
  }

  async deleteWorkflow(id: string): Promise<void> {
    await this.http.del<unknown>(`/workflows/${encodeURIComponent(id)}`);
  }

  getWorkflowDirectory(): string {
    return this.http.workflowDir;
  }

  private async resolveWorkflowPath(fileName: string): Promise<string> {
    const ext = extname(fileName).toLowerCase();
    if (ext !== ".workflow") {
      throw new Error("Workflow file name must end with .workflow");
    }
    return resolveFileInDirectory(
      this.http.workflowDir,
      fileName,
      "Workflow",
      "VCFA_WORKFLOW_DIR",
    );
  }

  async exportWorkflowFile(
    id: string,
    fileName: string,
    overwrite = false,
  ): Promise<string> {
    const destPath = await this.resolveWorkflowPath(fileName);
    const existingFile = await getExistingFile(destPath);
    if (existingFile?.isSymbolicLink()) {
      throw new Error("Workflow export target must not be a symbolic link");
    }
    if (existingFile && !overwrite) {
      throw new Error(
        `Workflow file already exists: ${fileName}. Set overwrite to true to replace it.`,
      );
    }

    const token = await this.http.ensureAuthenticated();
    const path = `/content/workflows/${encodeURIComponent(id)}`;
    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] GET ${path}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/zip",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vRO API error: ${res.status} ${res.statusText} — export workflow\n${text}`,
      );
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(destPath, buffer, { flag: overwrite ? "w" : "wx" });
    return destPath;
  }

  async scaffoldWorkflowFile(
    params: ScaffoldWorkflowFileParams,
  ): Promise<string> {
    const destPath = await this.resolveWorkflowPath(params.fileName);
    const existingFile = await getExistingFile(destPath);
    if (existingFile?.isSymbolicLink()) {
      throw new Error("Workflow scaffold target must not be a symbolic link");
    }
    if (existingFile && !params.overwrite) {
      throw new Error(
        `Workflow file already exists: ${params.fileName}. Set overwrite to true to replace it.`,
      );
    }

    const artifact = buildWorkflowArtifact(params.workflow);
    await writeFile(destPath, artifact, {
      flag: params.overwrite ? "w" : "wx",
    });
    return destPath;
  }

  async importWorkflowFile(
    categoryId: string,
    fileName: string,
    overwrite = true,
  ): Promise<void> {
    const srcPath = await this.resolveWorkflowPath(fileName);
    await rejectSymlink(
      srcPath,
      "Workflow import source must not be a symbolic link",
    );
    await assertRealPathInside(
      this.http.workflowDir,
      srcPath,
      "Workflow file path resolves outside VCFA_WORKFLOW_DIR",
    );
    const token = await this.http.ensureAuthenticated();
    const buffer = await readFile(srcPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)]), fileName);

    const path = `/workflows?categoryId=${encodeURIComponent(categoryId)}&overwrite=${overwrite}`;
    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] POST ${path}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vRO API error: ${res.status} ${res.statusText} — import workflow\n${text}`,
      );
    }
  }
}
