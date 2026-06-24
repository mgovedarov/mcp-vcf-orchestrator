import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import type {
  Category,
  DiffWorkflowFileParams,
  ExportWorkflowExecutionLogsParams,
  ExportWorkflowExecutionLogsResult,
  ListWorkflowsByCategoryParams,
  ScaffoldWorkflowFileParams,
  SimpleParameter,
  WorkflowCategoryGroup,
  WorkflowsByCategoryResult,
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
import { sanitizeErrorBody, type VroHttpClient } from "./core.js";
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
import { getAllVroPages } from "./pagination.js";
import { toVroParameters } from "./parameters.js";
import { buildWorkflowArtifact } from "./workflow-artifact.js";

const LOG_SEVERITY_RANK: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  warning: 30,
  error: 40,
};

const DEFAULT_MAX_CATEGORIES = 50;

const LOG_WRAPPER_KEYS = new Set(["attributes", "attribute", "log", "entry"]);

const CATEGORY_PARENT_ID_KEYS = [
  "parentId",
  "parent-id",
  "parentCategoryId",
  "parent-category-id",
];
const CATEGORY_PARENT_NAME_KEYS = [
  "parentName",
  "parent-name",
  "parentCategoryName",
  "parent-category-name",
];
const CATEGORY_PARENT_PATH_KEYS = [
  "parentPath",
  "parent-path",
  "parentCategoryPath",
  "parent-category-path",
];

type CategoryRelationLink = {
  href?: string;
  rel?: string;
  attributes?: { name: string; value: string }[];
};

type WorkflowCategoryDetail = Category & {
  relations?: { link?: CategoryRelationLink[] };
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
  const parts = Object.entries(source)
    .filter(([key, value]) => !LOG_WRAPPER_KEYS.has(key) && value !== undefined && value !== null)
    .filter(([, value]) =>
      ["string", "number", "boolean"].includes(typeof value),
    )
    .map(([key, value]) => `${key}: ${String(value)}`);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

export function normalizeWorkflowExecutionLog(
  raw: WorkflowExecutionLog,
): WorkflowExecutionLog {
  const direct = raw as Record<string, unknown>;
  const nested = objectField(direct, "log", "entry") ?? {};
  const attributes = getLinkAttrs(raw);
  const source = { ...direct, ...nested, ...attributes };
  const base: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!LOG_WRAPPER_KEYS.has(key) && value !== undefined) {
      base[key] = value;
    }
  }
  const normalized: WorkflowExecutionLog = {
    ...(base as WorkflowExecutionLog),
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

function firstAttribute(
  attrs: Record<string, string>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = attrs[key];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

function normalizeCategoryPath(path?: string): string {
  const trimmed = path?.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function categoryDisplayPath(category: Category): string {
  return normalizeCategoryPath(category.path) || category.name;
}

function parseWorkflowCategory(
  item: { href?: string; attributes?: { name: string; value: string }[] },
): Category {
  const attrs = parseAttrs(item.attributes);
  const category: Category = {
    id: attrs["id"] ?? attrs["@id"],
    name: attrs["name"] ?? attrs["@name"],
    description: attrs["description"],
    type: attrs["type"] ?? "WorkflowCategory",
    path: attrs["path"],
    parentId: firstAttribute(attrs, CATEGORY_PARENT_ID_KEYS),
    parentName: firstAttribute(attrs, CATEGORY_PARENT_NAME_KEYS),
    parentPath: firstAttribute(attrs, CATEGORY_PARENT_PATH_KEYS),
    href: item.href,
  };
  for (const key of ["parentId", "parentName", "parentPath"] as const) {
    if (category[key] === undefined) delete category[key];
  }
  return category;
}

function parseWorkflowRelation(
  link: CategoryRelationLink,
  category: Category,
): Workflow | undefined {
  if (link.rel !== "down") return undefined;
  const attrs = parseAttrs(link.attributes);
  const type = attrs["type"] ?? attrs["@type"] ?? attrs["@fullType"];
  if (type !== "Workflow") return undefined;
  const id = attrs["id"] ?? attrs["@id"];
  const name = attrs["name"] ?? attrs["@name"];
  if (!id || !name) return undefined;
  return {
    id,
    name,
    description: attrs["description"],
    version: attrs["version"],
    categoryId: category.id,
    categoryName: category.name,
    href: link.href,
  };
}

function parseChildCategoryRelation(link: CategoryRelationLink): Category | undefined {
  if (link.rel !== "down") return undefined;
  const attrs = parseAttrs(link.attributes);
  const type = attrs["type"] ?? attrs["@type"] ?? attrs["@fullType"];
  if (type !== "WorkflowCategory") return undefined;
  const category = parseWorkflowCategory(link);
  return category.id && category.name ? category : undefined;
}

function isWorkflowListPaginationFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("vRO pagination did not advance for /workflows")
  );
}

export function resolveWorkflowCategoryFromList(
  categories: Category[],
  params: ListWorkflowsByCategoryParams,
  truncated: boolean,
): Category | undefined {
  if (params.categoryId) {
    const category = categories.find((candidate) => candidate.id === params.categoryId);
    if (!category) {
      if (truncated) {
        throw new Error(
          `No WorkflowCategory found with id: ${params.categoryId} in the first ${categories.length} categories, but the live category list was truncated at the page-request cap, so it may exist beyond the returned page. Narrow the listing or retry rather than treating it as missing.`,
        );
      }
      throw new Error(`No WorkflowCategory found with id: ${params.categoryId}`);
    }
    return category;
  }

  if (params.categoryPath) {
    const path = normalizeCategoryPath(params.categoryPath);
    const category = categories.find(
      (candidate) => normalizeCategoryPath(candidate.path) === path,
    );
    return category;
  }

  const matches = categories.filter(
    (candidate) => candidate.name === params.categoryName,
  );
  if (matches.length === 0) {
    throw new Error(`No WorkflowCategory found with name: ${params.categoryName}`);
  }
  if (matches.length > 1) {
    const candidates = matches
      .map(
        (category) =>
          `${category.name} (id: ${category.id}${category.path ? `, path: ${category.path}` : ""})`,
      )
      .join("; ");
    throw new Error(
      `Multiple WorkflowCategory entries match name '${params.categoryName}'. Use categoryId or categoryPath. Candidates: ${candidates}`,
    );
  }
  return matches[0];
}

export class WorkflowClient {
  constructor(private http: VroHttpClient) {}

  private async getWorkflowCategoryDetail(
    category: Category,
  ): Promise<WorkflowCategoryDetail> {
    const raw = await this.http.get<{
      id?: string;
      name?: string;
      description?: string;
      type?: string;
      path?: string;
      href?: string;
      relations?: { link?: CategoryRelationLink[] };
    }>(`/categories/${encodeURIComponent(category.id)}`);
    return {
      ...category,
      id: raw.id ?? category.id,
      name: raw.name ?? category.name,
      description: raw.description ?? category.description,
      type: raw.type ?? category.type,
      path: raw.path ?? category.path,
      href: raw.href ?? category.href,
      relations: raw.relations,
    };
  }

  private async resolveWorkflowCategory(
    categories: Category[],
    params: ListWorkflowsByCategoryParams,
    truncated: boolean,
  ): Promise<Category> {
    const listMatch = resolveWorkflowCategoryFromList(
      categories,
      params,
      truncated,
    );
    if (listMatch) return listMatch;

    if (!params.categoryPath) {
      throw new Error("Workflow category selector did not resolve.");
    }

    const normalizedPath = normalizeCategoryPath(params.categoryPath);
    const lastSegment = normalizedPath.split("/").filter(Boolean).at(-1);
    const candidates = categories.filter(
      (category) => category.name === lastSegment,
    );
    const matches: Category[] = [];
    for (const candidate of candidates) {
      const detail = await this.getWorkflowCategoryDetail(candidate);
      if (normalizeCategoryPath(detail.path) === normalizedPath) {
        matches.push(detail);
      }
    }

    if (matches.length === 0) {
      if (truncated) {
        throw new Error(
          `No WorkflowCategory found with path: ${params.categoryPath} in the first ${categories.length} categories, but the live category list was truncated at the page-request cap, so it may exist beyond the returned page. Narrow the listing or retry rather than treating it as missing.`,
        );
      }
      throw new Error(`No WorkflowCategory found with path: ${params.categoryPath}`);
    }
    if (matches.length > 1) {
      const candidatesText = matches
        .map((category) => `${category.name} (id: ${category.id}, path: ${category.path})`)
        .join("; ");
      throw new Error(
        `Multiple WorkflowCategory entries match path '${params.categoryPath}'. Use categoryId. Candidates: ${candidatesText}`,
      );
    }
    return matches[0];
  }

  private async collectWorkflowCategoryTree(
    rootCategory: Category,
    maxCategories: number,
  ): Promise<{ groups: WorkflowCategoryGroup[]; truncated: boolean }> {
    const groups: WorkflowCategoryGroup[] = [];
    const stack = [rootCategory];
    const visited = new Set<string>();

    while (stack.length > 0) {
      // Check before pop: the root is always processed (resolved externally),
      // so truncation fires precisely at the configured boundary.
      if (visited.size >= maxCategories) {
        return { groups, truncated: true };
      }
      const current = stack.pop();
      if (!current || visited.has(current.id)) continue;
      visited.add(current.id);

      const detail = await this.getWorkflowCategoryDetail(current);
      const links = detail.relations?.link ?? [];
      const workflows = links
        .map((link) => parseWorkflowRelation(link, detail))
        .filter((workflow): workflow is Workflow => Boolean(workflow));
      groups.push({ category: detail, workflows });

      for (const link of links) {
        const child = parseChildCategoryRelation(link);
        if (child && !visited.has(child.id)) {
          stack.push(child);
        }
      }
    }

    return { groups, truncated: false };
  }

  private async listWorkflowsFromCategories(filter?: string): Promise<WorkflowList> {
    const rawCategories = await getAllVroPages<{
      href?: string;
      attributes?: { name: string; value: string }[];
    }>(
      this.http,
      "/categories",
      new URLSearchParams([["categoryType", "WorkflowCategory"]]),
    );
    const categories = (rawCategories.link ?? []).map(parseWorkflowCategory);
    const workflowsById = new Map<string, Workflow>();
    const normalizedFilter = filter?.toLowerCase();

    for (const category of categories) {
      const detail = await this.getWorkflowCategoryDetail(category);
      const links = detail.relations?.link ?? [];
      for (const workflow of links
        .map((link) => parseWorkflowRelation(link, detail))
        .filter((workflow): workflow is Workflow => Boolean(workflow))) {
        if (
          normalizedFilter &&
          !workflow.name.toLowerCase().includes(normalizedFilter)
        ) {
          continue;
        }
        workflowsById.set(workflow.id, workflow);
      }
    }

    const link = [...workflowsById.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return {
      total: link.length,
      link,
      ...(rawCategories.truncated ? { truncated: true } : {}),
    };
  }

  async listWorkflows(filter?: string): Promise<WorkflowList> {
    const params = new URLSearchParams();
    if (filter) {
      params.set("conditions", `name~${filter}`);
    }
    let raw: {
      link: { attributes?: { name: string; value: string }[] }[];
      total?: number;
      truncated?: boolean;
    };
    try {
      raw = await getAllVroPages<{
        attributes?: { name: string; value: string }[];
      }>(this.http, "/workflows", params);
    } catch (error) {
      if (!isWorkflowListPaginationFailure(error)) throw error;
      return this.listWorkflowsFromCategories(filter);
    }
    const link: Workflow[] = (raw.link ?? []).map((item) => {
      const a = parseAttrs(item.attributes);
      return {
        id: a["id"] ?? a["@id"],
        name: a["name"] ?? a["@name"],
        description: a["description"],
        version: a["version"],
        categoryId: a["categoryId"] ?? a["category-id"],
        categoryName: a["categoryName"] ?? a["category-name"],
      };
    });
    return {
      total: raw.total ?? link.length,
      link,
      ...(raw.truncated ? { truncated: true } : {}),
    };
  }

  async listWorkflowsByCategory(
    params: ListWorkflowsByCategoryParams,
  ): Promise<WorkflowsByCategoryResult> {
    const selectors = [
      params.categoryId,
      params.categoryName,
      params.categoryPath,
    ].filter((value) => value !== undefined && value !== "");
    if (selectors.length !== 1) {
      throw new Error(
        "Provide exactly one workflow category selector: categoryId, categoryName, or categoryPath.",
      );
    }

    const maxCategories = params.maxCategories ?? DEFAULT_MAX_CATEGORIES;
    const rawCategories = await getAllVroPages<{
      href?: string;
      attributes?: { name: string; value: string }[];
    }>(
      this.http,
      "/categories",
      new URLSearchParams([["categoryType", "WorkflowCategory"]]),
    );
    const categories = (rawCategories.link ?? []).map(parseWorkflowCategory);
    const rootCategory = await this.resolveWorkflowCategory(
      categories,
      params,
      rawCategories.truncated ?? false,
    );
    const { groups: rawGroups, truncated } = await this.collectWorkflowCategoryTree(
      rootCategory,
      maxCategories,
    );
    const groups = rawGroups
      .filter(
        (group) => params.includeEmptyCategories || group.workflows.length > 0,
      )
      .sort((a, b) =>
        categoryDisplayPath(a.category).localeCompare(categoryDisplayPath(b.category)),
      );

    return {
      rootCategory,
      categories: groups,
      workflowCount: groups.reduce(
        (count, group) => count + group.workflows.length,
        0,
      ),
      ...(truncated ? { truncated } : {}),
    };
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
      body.parameters = toVroParameters(inputs);
    }
    return this.http.startExecution<WorkflowExecution>(
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
    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] GET ${path}`);

    const res = await this.http.authenticatedFetch(
      url,
      { method: "GET", headers: { Accept: "application/zip" } },
      { timeout: 60_000 },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vRO API error: ${res.status} ${res.statusText} — export workflow\n${sanitizeErrorBody(text, res)}`,
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

    const url = `${this.http.baseUrl}${path}`;
    console.error(`[vro-client] POST ${path}`);

    const res = await this.http.authenticatedFetch(
      url,
      { method: "POST", headers: { Accept: "application/json" }, body: form },
      { timeout: 60_000 },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vRO API error: ${res.status} ${res.statusText} — import workflow\n${sanitizeErrorBody(text, res)}`,
      );
    }
  }
}
