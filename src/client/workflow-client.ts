import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import type {
  DiffWorkflowFileParams,
  ExportWorkflowExecutionLogsParams,
  ExportWorkflowExecutionLogsResult,
  ScaffoldWorkflowFileParams,
  SimpleParameter,
  Workflow,
  WorkflowExecution,
  WorkflowExecutionLog,
  WorkflowExecutionLogExportFormat,
  WorkflowExecutionLogLevel,
  WorkflowExecutionList,
  WorkflowExecutionLogs,
  WorkflowList,
} from "../types.js";
import { getLinkAttrs, parseAttrs } from "./attrs.js";
import type { VroHttpClient } from "./core.js";
import {
  diffWorkflowArtifacts,
  ensurePreflightPassed,
  inspectWorkflowArtifactBuffer,
  preflightWorkflowFile,
  type ArtifactPreflightReport,
} from "./artifact-preflight.js";
import {
  assertRealPathInside,
  getExistingFile,
  rejectSymlink,
  resolveFileInDirectory,
} from "./files.js";
import { buildWorkflowArtifact } from "./workflow-artifact.js";

const LOG_SEVERITY_RANK: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  warning: 30,
  error: 40,
};

function normalizeLogLevel(level: string): WorkflowExecutionLogLevel {
  const normalized = level.toLowerCase();
  if (normalized === "debug" || normalized === "info" || normalized === "error") {
    return normalized;
  }
  throw new Error("Execution log level must be one of: debug, info, error.");
}

function inferLogExportFormat(
  fileName: string,
  format?: WorkflowExecutionLogExportFormat,
): WorkflowExecutionLogExportFormat {
  const ext = extname(fileName).toLowerCase();
  const inferred =
    ext === ".json" ? "json" : ext === ".txt" ? "text" : undefined;
  if (!inferred) {
    throw new Error("Execution log export file name must end with .json or .txt");
  }
  if (format !== undefined && format !== inferred) {
    throw new Error(
      `Execution log export format ${format} does not match file extension ${ext}`,
    );
  }
  return format ?? inferred;
}

function logSeverityRank(log: WorkflowExecutionLog): number | null {
  const severity = log.severity?.toLowerCase();
  if (!severity) return null;
  return LOG_SEVERITY_RANK[severity] ?? null;
}

export function filterWorkflowExecutionLogsByMinimumLevel(
  logs: WorkflowExecutionLog[],
  level: WorkflowExecutionLogLevel,
): WorkflowExecutionLog[] {
  const threshold = LOG_SEVERITY_RANK[level];
  return logs.filter((log) => {
    const rank = logSeverityRank(log);
    return rank === null ? level === "debug" : rank >= threshold;
  });
}

function stringField(
  source: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return undefined;
}

function numericField(
  source: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function objectField(
  source: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return undefined;
}

function scalarSummary(source: Record<string, unknown>): string | undefined {
  const skipped = new Set(["attributes", "attribute", "log", "entry"]);
  const parts = Object.entries(source)
    .filter(([key, value]) => !skipped.has(key) && value !== undefined && value !== null)
    .filter(([, value]) =>
      ["string", "number", "boolean"].includes(typeof value),
    )
    .map(([key, value]) => `${key}: ${String(value)}`);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function normalizeWorkflowExecutionLog(
  raw: WorkflowExecutionLog,
): WorkflowExecutionLog {
  const direct = raw as Record<string, unknown>;
  const nested = objectField(direct, "log", "entry") ?? {};
  const attributes = getLinkAttrs(raw);
  const source = { ...direct, ...nested, ...attributes };
  const normalized: WorkflowExecutionLog = {
    ...raw,
    ...nested,
    ...attributes,
  };

  normalized.severity = stringField(source, "severity", "level", "logLevel");
  normalized.origin = stringField(source, "origin", "source");
  normalized.userName = stringField(source, "userName", "username", "user-name");
  normalized.user = stringField(source, "user");
  normalized["short-description"] = stringField(
    source,
    "short-description",
    "shortDescription",
    "message",
    "msg",
    "description",
    "text",
  );
  normalized["long-description"] = stringField(
    source,
    "long-description",
    "longDescription",
    "details",
    "detail",
  );
  normalized["time-stamp"] = stringField(
    source,
    "time-stamp",
    "timeStamp",
    "timestamp",
    "date",
  );
  normalized["time-stamp-val"] = numericField(
    source,
    "time-stamp-val",
    "timeStampVal",
    "timestampValue",
  );

  if (!normalized["short-description"] && !normalized["long-description"]) {
    normalized["short-description"] = scalarSummary(source);
  }

  return normalized;
}

export function formatWorkflowExecutionLogEntry(
  log: WorkflowExecutionLog,
): string {
  const normalized = normalizeWorkflowExecutionLog(log);
  const prefix = [
    normalized["time-stamp"],
    normalized.severity ? `[${normalized.severity}]` : undefined,
    normalized.origin,
  ].filter(Boolean);
  const shortDescription = normalized["short-description"];
  const longDescription = normalized["long-description"];
  const description =
    shortDescription && longDescription && shortDescription !== longDescription
      ? `${shortDescription} — ${longDescription}`
      : (shortDescription ?? longDescription ?? "(no description)");
  return `${prefix.length > 0 ? `${prefix.join(" ")} ` : ""}${description}`;
}

function renderExecutionLogsText(params: {
  workflowId: string;
  executionId: string;
  level: WorkflowExecutionLogLevel;
  exportedAt: string;
  fetchedCount: number;
  logs: WorkflowExecutionLog[];
}): string {
  const header = [
    `Workflow ID: ${params.workflowId}`,
    `Execution ID: ${params.executionId}`,
    `Minimum level: ${params.level}`,
    `Exported at: ${params.exportedAt}`,
    `Fetched log count: ${params.fetchedCount}`,
    `Exported log count: ${params.logs.length}`,
  ];
  const body =
    params.logs.length === 0
      ? ["No execution logs matched the export level."]
      : params.logs.map((log) => `• ${formatWorkflowExecutionLogEntry(log)}`);
  return [...header, "", ...body, ""].join("\n");
}

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
      `/workflows/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(executionId)}/syslogs${query}`,
    ).then((result) => ({
      ...result,
      logs: (result.logs ?? []).map(normalizeWorkflowExecutionLog),
    }));
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

  getExecutionLogDirectory(): string {
    return this.http.executionLogDir;
  }

  preflightWorkflowFile(fileName: string): Promise<ArtifactPreflightReport> {
    return preflightWorkflowFile(this.http.workflowDir, fileName);
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
      "the configured workflow artifact directory",
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

    const buffer = await this.exportWorkflowBuffer(id);
    await writeFile(destPath, buffer, { flag: overwrite ? "w" : "wx" });
    return destPath;
  }

  private async resolveExecutionLogPath(
    fileName: string,
    format?: WorkflowExecutionLogExportFormat,
  ): Promise<{
    destPath: string;
    format: WorkflowExecutionLogExportFormat;
  }> {
    const resolvedFormat = inferLogExportFormat(fileName, format);
    const destPath = await resolveFileInDirectory(
      this.http.executionLogDir,
      fileName,
      "Execution log export",
      "the configured execution log artifact directory",
    );
    return { destPath, format: resolvedFormat };
  }

  async exportWorkflowExecutionLogs(
    params: ExportWorkflowExecutionLogsParams,
  ): Promise<ExportWorkflowExecutionLogsResult> {
    const level = normalizeLogLevel(params.level ?? "info");
    const { destPath, format } = await this.resolveExecutionLogPath(
      params.fileName,
      params.format,
    );
    const existingFile = await getExistingFile(destPath);
    if (existingFile?.isSymbolicLink()) {
      throw new Error("Execution log export target must not be a symbolic link");
    }
    if (existingFile && !params.overwrite) {
      throw new Error(
        `Execution log export file already exists: ${params.fileName}. Set overwrite to true to replace it.`,
      );
    }

    const logs =
      (
        await this.getWorkflowExecutionLogs(params.workflowId, params.executionId, {
          maxResult: params.maxResult,
        })
      ).logs ?? [];
    const filteredLogs = filterWorkflowExecutionLogsByMinimumLevel(logs, level);
    const exportedAt = new Date().toISOString();
    const content =
      format === "json"
        ? `${JSON.stringify(
            {
              metadata: {
                workflowId: params.workflowId,
                executionId: params.executionId,
                level,
                format,
                exportedAt,
                fetchedCount: logs.length,
                exportedCount: filteredLogs.length,
              },
              logs: filteredLogs,
            },
            null,
            2,
          )}\n`
        : renderExecutionLogsText({
            workflowId: params.workflowId,
            executionId: params.executionId,
            level,
            exportedAt,
            fetchedCount: logs.length,
            logs: filteredLogs,
          });

    await writeFile(destPath, content, { flag: params.overwrite ? "w" : "wx" });
    return {
      path: destPath,
      level,
      format,
      fetchedCount: logs.length,
      exportedCount: filteredLogs.length,
    };
  }

  async exportWorkflowBuffer(id: string): Promise<Buffer> {
    const path = `/content/workflows/${encodeURIComponent(id)}`;
    this.http.assertOperationSupported("GET", path);
    const authorization = await this.http.authorizationHeader();
    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] GET ${path}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: authorization,
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
    return Buffer.from(await res.arrayBuffer());
  }

  async diffWorkflowFile(params: DiffWorkflowFileParams): Promise<string> {
    const base = await this.inspectWorkflowDiffSource(params.base);
    const compare = await this.inspectWorkflowDiffSource(params.compare);
    return diffWorkflowArtifacts(base, compare);
  }

  private async inspectWorkflowDiffSource(source: DiffWorkflowFileParams["base"]) {
    if (source.source === "live") {
      return inspectWorkflowArtifactBuffer(
        await this.exportWorkflowBuffer(source.workflowId),
        `live workflow ${source.workflowId}`,
      );
    }

    const filePath = await this.resolveWorkflowPath(source.fileName);
    await rejectSymlink(
      filePath,
      "Workflow diff source must not be a symbolic link",
    );
    await assertRealPathInside(
      this.http.workflowDir,
      filePath,
      "Workflow file path resolves outside the configured workflow artifact directory",
    );
    return inspectWorkflowArtifactBuffer(
      new Uint8Array(await readFile(filePath)),
      source.fileName,
    );
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
    const path = `/workflows?categoryId=${encodeURIComponent(categoryId)}&overwrite=${overwrite}`;
    this.http.assertOperationSupported("POST", path);
    ensurePreflightPassed(await this.preflightWorkflowFile(fileName));
    const srcPath = await this.resolveWorkflowPath(fileName);
    await rejectSymlink(
      srcPath,
      "Workflow import source must not be a symbolic link",
    );
    await assertRealPathInside(
      this.http.workflowDir,
      srcPath,
      "Workflow file path resolves outside the configured workflow artifact directory",
    );
    const buffer = await readFile(srcPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)]), fileName);

    this.http.assertOperationSupported("POST", path);
    const authorization = await this.http.authorizationHeader();
    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] POST ${path}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: authorization,
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
