import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import type {
  Action,
  CatalogItem,
  Category,
  ConfigAttribute,
  ConfigElement,
  EventTopic,
  ResourceElement,
  Subscription,
  Template,
  VroPackage,
  VroParameter,
  VroPlugin,
  Workflow,
} from "../types.js";
import { getExistingFile, resolveFileInDirectory } from "./files.js";

const CORE_DOMAINS = [
  "workflows",
  "actions",
  "configurations",
  "resources",
  "categories",
] as const;

const OPTIONAL_DOMAINS = [
  "templates",
  "catalogItems",
  "eventTopics",
  "subscriptions",
  "packages",
  "plugins",
] as const;

const CATEGORY_TYPES = [
  "WorkflowCategory",
  "ActionCategory",
  "ConfigurationElementCategory",
  "ResourceElementCategory",
] as const;

export type ContextSnapshotDomain =
  | (typeof CORE_DOMAINS)[number]
  | (typeof OPTIONAL_DOMAINS)[number];

export interface CollectContextSnapshotParams {
  fileBaseName?: string;
  overwrite?: boolean;
  domains?: ContextSnapshotDomain[];
  includeOptionalDomains?: boolean;
  maxItemsPerDomain?: number;
}

export interface CollectContextSnapshotResult {
  jsonPath: string;
  markdownPath: string;
  counts: Record<string, number>;
  skipped: Record<string, number>;
  warnings: string[];
}

export interface ContextSnapshotClient {
  getContextDirectory(): string;
  listWorkflows(filter?: string): Promise<{ link: Workflow[]; total?: number }>;
  getWorkflow(id: string): Promise<Workflow>;
  listActions(filter?: string): Promise<{ link: Action[]; total?: number }>;
  getAction(id: string): Promise<Action>;
  listConfigurations(filter?: string): Promise<{
    link: ConfigElement[];
    total?: number;
  }>;
  getConfiguration(id: string): Promise<ConfigElement>;
  listResources(filter?: string): Promise<{
    link: ResourceElement[];
    total?: number;
  }>;
  listCategories(
    categoryType: string,
    filter?: string,
  ): Promise<{ link: Category[]; total?: number }>;
  listTemplates(search?: string, projectId?: string): Promise<{
    content: Template[];
    totalElements?: number;
  }>;
  getTemplate(id: string): Promise<Template>;
  listCatalogItems(search?: string): Promise<{
    content: CatalogItem[];
    totalElements?: number;
  }>;
  getCatalogItem(id: string): Promise<CatalogItem>;
  listEventTopics(): Promise<{ content: EventTopic[]; totalElements?: number }>;
  listSubscriptions(projectId?: string): Promise<{
    content: Subscription[];
    totalElements?: number;
  }>;
  listPackages(filter?: string): Promise<{ link: VroPackage[]; total?: number }>;
  getPackage(name: string): Promise<VroPackage>;
  listPlugins(filter?: string): Promise<{ link: VroPlugin[]; total?: number }>;
}

interface DomainStats {
  count: number;
  skipped: number;
}

type SnapshotSection = unknown[] | Record<string, unknown[]>;

interface ContextSnapshot {
  schemaVersion: 1;
  domains: ContextSnapshotDomain[];
  limits: { maxItemsPerDomain: number };
  warnings: string[];
  counts: Record<string, number>;
  skipped: Record<string, number>;
  data: Record<string, SnapshotSection>;
}

export async function collectContextSnapshot(
  client: ContextSnapshotClient,
  params: CollectContextSnapshotParams = {},
): Promise<CollectContextSnapshotResult> {
  const fileBaseName = params.fileBaseName ?? "vcfa-context";
  validateFileBaseName(fileBaseName);
  const maxItemsPerDomain = normalizeLimit(params.maxItemsPerDomain);
  const domains = resolveDomains(params.domains, params.includeOptionalDomains);
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const data: Record<string, SnapshotSection> = {};

  const snapshot: ContextSnapshot = {
    schemaVersion: 1,
    domains,
    limits: { maxItemsPerDomain },
    warnings,
    counts,
    skipped,
    data,
  };

  for (const domain of domains) {
    const result = await collectDomain(client, domain, maxItemsPerDomain, warnings);
    data[domain] = result.data;
    counts[domain] = result.stats.count;
    skipped[domain] = result.stats.skipped;
  }

  const jsonPath = await resolveSnapshotPath(client, `${fileBaseName}.json`);
  const markdownPath = await resolveSnapshotPath(client, `${fileBaseName}.md`);
  await ensureWritable(jsonPath, `${fileBaseName}.json`, params.overwrite);
  await ensureWritable(markdownPath, `${fileBaseName}.md`, params.overwrite);

  await writeFile(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    flag: params.overwrite ? "w" : "wx",
  });
  await writeFile(markdownPath, renderMarkdown(snapshot), {
    flag: params.overwrite ? "w" : "wx",
  });

  return { jsonPath, markdownPath, counts, skipped, warnings };
}

async function collectDomain(
  client: ContextSnapshotClient,
  domain: ContextSnapshotDomain,
  maxItems: number,
  warnings: string[],
): Promise<{ data: SnapshotSection; stats: DomainStats }> {
  switch (domain) {
    case "workflows":
      return collectListWithDetails(
        "workflows",
        () => client.listWorkflows(),
        (item) => item.id,
        (id) => client.getWorkflow(id),
        summarizeWorkflow,
        maxItems,
        warnings,
      );
    case "actions":
      return collectListWithDetails(
        "actions",
        () => client.listActions(),
        (item) => item.id || item.fqn,
        (id) => client.getAction(id),
        summarizeAction,
        maxItems,
        warnings,
      );
    case "configurations":
      return collectListWithDetails(
        "configurations",
        () => client.listConfigurations(),
        (item) => item.id,
        (id) => client.getConfiguration(id),
        summarizeConfiguration,
        maxItems,
        warnings,
      );
    case "resources": {
      const list = await client.listResources();
      const items = sortByNameAndId(list.link ?? []).slice(0, maxItems);
      return {
        data: items.map(summarizeResource),
        stats: boundedStats(list.link ?? [], maxItems),
      };
    }
    case "categories":
      return collectCategories(client, maxItems, warnings);
    case "templates":
      return collectListWithDetails(
        "templates",
        () => client.listTemplates(),
        (item) => item.id,
        (id) => client.getTemplate(id),
        summarizeTemplate,
        maxItems,
        warnings,
        "content",
      );
    case "catalogItems":
      return collectListWithDetails(
        "catalogItems",
        () => client.listCatalogItems(),
        (item) => item.id,
        (id) => client.getCatalogItem(id),
        summarizeCatalogItem,
        maxItems,
        warnings,
        "content",
      );
    case "eventTopics": {
      const list = await client.listEventTopics();
      const items = sortByNameAndId(list.content ?? []).slice(0, maxItems);
      return {
        data: items.map(summarizeEventTopic),
        stats: boundedStats(list.content ?? [], maxItems),
      };
    }
    case "subscriptions": {
      const list = await client.listSubscriptions();
      const items = sortByNameAndId(list.content ?? []).slice(0, maxItems);
      return {
        data: items.map(summarizeSubscription),
        stats: boundedStats(list.content ?? [], maxItems),
      };
    }
    case "packages":
      return collectListWithDetails(
        "packages",
        () => client.listPackages(),
        (item) => item.name,
        (name) => client.getPackage(name),
        summarizePackage,
        maxItems,
        warnings,
      );
    case "plugins": {
      const list = await client.listPlugins();
      const items = sortByNameAndId(list.link ?? []).slice(0, maxItems);
      return {
        data: items.map(summarizePlugin),
        stats: boundedStats(list.link ?? [], maxItems),
      };
    }
  }
}

async function collectListWithDetails<TListItem, TDetail>(
  domain: string,
  listFn: () => Promise<{ link?: TListItem[]; content?: TListItem[] }>,
  idFn: (item: TListItem) => string | undefined,
  detailFn: (id: string) => Promise<TDetail>,
  summarize: (item: TDetail | TListItem) => unknown,
  maxItems: number,
  warnings: string[],
  listField: "link" | "content" = "link",
): Promise<{ data: unknown[]; stats: DomainStats }> {
  const list = await listFn();
  const rawItems = (list[listField] ?? []) as TListItem[];
  const items = sortByNameAndId(rawItems).slice(0, maxItems);
  const data: unknown[] = [];
  for (const item of items) {
    const id = idFn(item);
    if (!id) {
      warnings.push(`${domain}: skipped item without an ID or name`);
      data.push(summarize(item));
      continue;
    }
    try {
      data.push(summarize(await detailFn(id)));
    } catch (error) {
      warnings.push(
        `${domain}: detail lookup failed for ${id}: ${formatError(error)}`,
      );
      data.push(summarize(item));
    }
  }
  return { data, stats: boundedStats(rawItems, maxItems) };
}

async function collectCategories(
  client: ContextSnapshotClient,
  maxItems: number,
  warnings: string[],
): Promise<{ data: Record<string, unknown[]>; stats: DomainStats }> {
  const data: Record<string, unknown[]> = {};
  let count = 0;
  let skipped = 0;
  for (const categoryType of CATEGORY_TYPES) {
    try {
      const list = await client.listCategories(categoryType);
      const raw = list.link ?? [];
      data[categoryType] = sortByNameAndId(raw)
        .slice(0, maxItems)
        .map(summarizeCategory);
      count += Math.min(raw.length, maxItems);
      skipped += Math.max(0, raw.length - maxItems);
    } catch (error) {
      warnings.push(
        `categories: lookup failed for ${categoryType}: ${formatError(error)}`,
      );
      data[categoryType] = [];
    }
  }
  return { data, stats: { count, skipped } };
}

function summarizeWorkflow(workflow: Workflow) {
  return dropUndefined({
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    version: workflow.version,
    categoryId: workflow.categoryId,
    categoryName: workflow.categoryName,
    inputs: summarizeParameters(
      workflow.inputParameters ?? workflow["input-parameters"],
    ),
    outputs: summarizeParameters(
      workflow.outputParameters ?? workflow["output-parameters"],
    ),
  });
}

function summarizeAction(action: Action) {
  return dropUndefined({
    id: action.id,
    fqn: action.fqn,
    module: action.module,
    name: action.name,
    description: action.description,
    version: action.version,
    inputs: summarizeParameters(action["input-parameters"]),
    returnType: action["output-type"],
    script: contentMetadata(action.script),
  });
}

function summarizeConfiguration(config: ConfigElement) {
  return dropUndefined({
    id: config.id,
    name: config.name,
    description: config.description,
    version: config.version,
    categoryId: config.categoryId,
    attributes: (config.attributes ?? []).map(summarizeAttribute),
  });
}

function summarizeResource(resource: ResourceElement) {
  return dropUndefined({
    id: resource.id,
    name: resource.name,
    description: resource.description,
    version: resource.version,
    categoryId: resource.categoryId,
    categoryName: resource.categoryName,
    mimeType: resource.mimeType,
  });
}

function summarizeCategory(category: Category) {
  return dropUndefined({
    id: category.id,
    name: category.name,
    description: category.description,
    type: category.type,
    path: category.path,
  });
}

function summarizeTemplate(template: Template) {
  return dropUndefined({
    id: template.id,
    name: template.name,
    description: template.description,
    status: template.status,
    projectId: template.projectId,
    projectName: template.projectName,
    requestScopeOrg: template.requestScopeOrg,
    valid: template.valid,
    content: contentMetadata(template.content),
  });
}

function summarizeCatalogItem(item: CatalogItem) {
  return dropUndefined({
    id: item.id,
    name: item.name,
    description: item.description,
    type: item.type,
    sourceType: item.sourceType,
    sourceName: item.sourceName,
    sourceId: item.sourceId,
    projectIds: item.projectIds,
    requestScopeOrg: item.requestScopeOrg,
  });
}

function summarizeEventTopic(topic: EventTopic) {
  return dropUndefined({
    id: topic.id,
    name: topic.name,
    description: topic.description,
    blockable: topic.blockable,
    schema: topic.schema
      ? { included: false, sha256: hash(JSON.stringify(topic.schema)), length: JSON.stringify(topic.schema).length }
      : undefined,
  });
}

function summarizeSubscription(subscription: Subscription) {
  return dropUndefined({
    id: subscription.id,
    name: subscription.name,
    description: subscription.description,
    type: subscription.type,
    disabled: subscription.disabled,
    eventTopicId: subscription.eventTopicId,
    runnableType: subscription.runnableType,
    runnableId: subscription.runnableId,
    blocking: subscription.blocking,
    priority: subscription.priority,
    timeout: subscription.timeout,
    projectId: subscription.projectId,
  });
}

function summarizePackage(pkg: VroPackage) {
  return dropUndefined({
    name: pkg.name,
    description: pkg.description,
    version: pkg.version,
  });
}

function summarizePlugin(plugin: VroPlugin) {
  return dropUndefined({
    name: plugin.name,
    displayName: plugin.displayName,
    description: plugin.description,
    version: plugin.version,
    type: plugin.type,
  });
}

function summarizeAttribute(attribute: ConfigAttribute) {
  return dropUndefined({
    name: attribute.name,
    type: attribute.type,
    description: attribute.description,
    value: attribute.value ? { included: false, redacted: true } : undefined,
  });
}

function summarizeParameters(parameters?: VroParameter[]) {
  return (parameters ?? []).map((parameter) =>
    dropUndefined({
      name: parameter.name,
      type: parameter.type,
      description: parameter.description,
    }),
  );
}

function contentMetadata(content?: string) {
  if (content === undefined) return undefined;
  return {
    included: false,
    sha256: hash(content),
    length: content.length,
  };
}

function renderMarkdown(snapshot: ContextSnapshot): string {
  const lines = [
    "# VCFA Context Snapshot",
    "",
    `Schema version: ${snapshot.schemaVersion}`,
    `Domains: ${snapshot.domains.join(", ")}`,
    `Max items per domain: ${snapshot.limits.maxItemsPerDomain}`,
    "",
  ];

  if (snapshot.warnings.length > 0) {
    lines.push("## Warnings", "");
    lines.push(...snapshot.warnings.map((warning) => `- ${warning}`), "");
  }

  lines.push("## Summary", "");
  for (const domain of snapshot.domains) {
    lines.push(
      `- ${domain}: ${snapshot.counts[domain] ?? 0} collected, ${snapshot.skipped[domain] ?? 0} skipped`,
    );
  }

  for (const domain of snapshot.domains) {
    lines.push("", `## ${title(domain)}`, "");
    const section = snapshot.data[domain];
    if (Array.isArray(section)) {
      renderItemList(lines, section);
    } else {
      for (const [group, items] of Object.entries(section ?? {})) {
        lines.push(`### ${group}`, "");
        renderItemList(lines, items);
        lines.push("");
      }
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderItemList(lines: string[], items: unknown[]): void {
  if (items.length === 0) {
    lines.push("_None._");
    return;
  }
  for (const item of items) {
    const record = item as Record<string, unknown>;
    const label = String(record.name ?? record.fqn ?? record.id ?? "unnamed");
    const id = record.id ? ` (${record.id})` : "";
    lines.push(`- ${label}${id}`);
    const details = Object.entries(record)
      .filter(([key]) => !["id", "name"].includes(key))
      .filter(([, value]) => value !== undefined && !isEmptyArray(value));
    for (const [key, value] of details) {
      lines.push(`  - ${key}: ${formatMarkdownValue(value)}`);
    }
  }
}

function formatMarkdownValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `\`${JSON.stringify(value)}\``;
}

function validateFileBaseName(fileBaseName: string): void {
  if (!fileBaseName.trim()) {
    throw new Error("Context snapshot fileBaseName must not be empty");
  }
  if (
    isAbsolute(fileBaseName) ||
    fileBaseName !== basename(fileBaseName) ||
    fileBaseName.includes("/") ||
    fileBaseName.includes("\\")
  ) {
    throw new Error(
      "Context snapshot fileBaseName must be a plain file name without path separators",
    );
  }
  if (fileBaseName.endsWith(".json") || fileBaseName.endsWith(".md")) {
    throw new Error("Context snapshot fileBaseName must not include an extension");
  }
}

async function resolveSnapshotPath(
  client: ContextSnapshotClient,
  fileName: string,
): Promise<string> {
  return resolveFileInDirectory(
    client.getContextDirectory(),
    fileName,
    "Context snapshot",
    "the configured context directory",
  );
}

async function ensureWritable(
  path: string,
  fileName: string,
  overwrite?: boolean,
): Promise<void> {
  const existing = await getExistingFile(path);
  if (existing?.isSymbolicLink()) {
    throw new Error("Context snapshot export target must not be a symbolic link");
  }
  if (existing && !overwrite) {
    throw new Error(
      `Context snapshot file already exists: ${fileName}. Set overwrite to true to replace it.`,
    );
  }
}

function resolveDomains(
  requested?: ContextSnapshotDomain[],
  includeOptionalDomains?: boolean,
): ContextSnapshotDomain[] {
  const domains = requested?.length ? requested : [...CORE_DOMAINS];
  const resolved = new Set<ContextSnapshotDomain>(domains);
  if (includeOptionalDomains) {
    for (const domain of OPTIONAL_DOMAINS) resolved.add(domain);
  }
  return [...resolved].sort();
}

function normalizeLimit(limit?: number): number {
  if (limit === undefined) return 100;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("maxItemsPerDomain must be a positive integer");
  }
  return limit;
}

function boundedStats(items: unknown[], maxItems: number): DomainStats {
  return {
    count: Math.min(items.length, maxItems),
    skipped: Math.max(0, items.length - maxItems),
  };
}

function sortByNameAndId<T>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const left = sortKey(a);
    const right = sortKey(b);
    return left.localeCompare(right);
  });
}

function sortKey(value: unknown): string {
  const record = value as Record<string, unknown>;
  return String(record.name ?? record.fqn ?? record.id ?? "").toLowerCase();
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function title(value: string): string {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
