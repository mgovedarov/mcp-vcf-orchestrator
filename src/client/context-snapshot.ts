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

export type ContextSnapshotProfile = "default" | "vcfaBuiltIns";

export interface CollectContextSnapshotParams {
  fileBaseName?: string;
  overwrite?: boolean;
  domains?: ContextSnapshotDomain[];
  includeOptionalDomains?: boolean;
  maxItemsPerDomain?: number;
  profile?: ContextSnapshotProfile;
  contextDir?: string;
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
  profile: ContextSnapshotProfile;
  domains: ContextSnapshotDomain[];
  limits: { maxItemsPerDomain: number };
  criteria?: Record<string, string>;
  warnings: string[];
  counts: Record<string, number>;
  skipped: Record<string, number>;
  data: Record<string, SnapshotSection>;
}

export async function collectContextSnapshot(
  client: ContextSnapshotClient,
  params: CollectContextSnapshotParams = {},
): Promise<CollectContextSnapshotResult> {
  const profile = params.profile ?? "default";
  const fileBaseName =
    params.fileBaseName ??
    (profile === "vcfaBuiltIns" ? "vcfa-builtins-context" : "vcfa-context");
  validateFileBaseName(fileBaseName);
  const maxItemsPerDomain = normalizeLimit(
    params.maxItemsPerDomain ?? (profile === "vcfaBuiltIns" ? 1000 : undefined),
  );
  const domains = resolveDomains(
    params.domains,
    params.includeOptionalDomains,
    profile,
  );
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const data: Record<string, SnapshotSection> = {};

  const snapshot: ContextSnapshot = {
    schemaVersion: 1,
    profile,
    domains,
    limits: { maxItemsPerDomain },
    criteria: profileCriteria(profile),
    warnings,
    counts,
    skipped,
    data,
  };

  for (const domain of domains) {
    const result = await collectDomain(
      client,
      domain,
      maxItemsPerDomain,
      warnings,
      profile,
    );
    data[domain] = result.data;
    counts[domain] = result.stats.count;
    skipped[domain] = result.stats.skipped;
  }

  const jsonPath = await resolveSnapshotPath(
    client,
    `${fileBaseName}.json`,
    params.contextDir,
  );
  const markdownPath = await resolveSnapshotPath(
    client,
    `${fileBaseName}.md`,
    params.contextDir,
  );
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
  profile: ContextSnapshotProfile,
): Promise<{ data: SnapshotSection; stats: DomainStats }> {
  switch (domain) {
    case "workflows":
      if (profile === "vcfaBuiltIns") {
        return collectBuiltInWorkflows(client, maxItems, warnings);
      }
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
      if (profile === "vcfaBuiltIns") {
        return collectBuiltInActions(client, maxItems, warnings);
      }
      return collectListWithDetails(
        "actions",
        () => client.listActions(),
        actionDetailReference,
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

async function collectBuiltInWorkflows(
  client: ContextSnapshotClient,
  maxItems: number,
  warnings: string[],
): Promise<{ data: unknown[]; stats: DomainStats }> {
  const libraryCategoryIds =
    await getLibraryWorkflowDescendantCategoryIds(client, warnings);
  const list = await client.listWorkflows();
  const filtered = (list.link ?? []).filter((workflow) =>
    isLibraryWorkflow(workflow, libraryCategoryIds),
  );
  return collectFilteredListWithDetails(
    "workflows",
    filtered,
    (item) => item.id,
    (id) => client.getWorkflow(id),
    summarizeWorkflow,
    maxItems,
    warnings,
  );
}

async function collectBuiltInActions(
  client: ContextSnapshotClient,
  maxItems: number,
  warnings: string[],
): Promise<{ data: unknown[]; stats: DomainStats }> {
  const list = await client.listActions();
  const filtered = (list.link ?? []).filter((action) =>
    isVmwareActionModule(action.module),
  );
  return collectFilteredListWithDetails(
    "actions",
    filtered,
    builtInActionDetailReference,
    (id) => client.getAction(id),
    summarizeAction,
    maxItems,
    warnings,
    { aggregateNotFoundWarnings: true },
  );
}

async function collectFilteredListWithDetails<TListItem, TDetail>(
  domain: string,
  rawItems: TListItem[],
  idFn: (item: TListItem) => string | undefined,
  detailFn: (id: string) => Promise<TDetail>,
  summarize: (item: TDetail | TListItem) => unknown,
  maxItems: number,
  warnings: string[],
  options: { aggregateNotFoundWarnings?: boolean } = {},
): Promise<{ data: unknown[]; stats: DomainStats }> {
  const items = sortByNameAndId(rawItems).slice(0, maxItems);
  const data: unknown[] = [];
  const notFoundDetails: { id: string; item: TListItem }[] = [];
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
      if (options.aggregateNotFoundWarnings && isNotFoundError(error)) {
        notFoundDetails.push({ id, item });
        data.push(summarize(item));
        continue;
      }
      warnings.push(
        `${domain}: detail lookup failed for ${id}: ${formatError(error)}`,
      );
      data.push(summarize(item));
    }
  }
  if (notFoundDetails.length > 0) {
    warnings.push(formatAggregatedNotFoundWarning(domain, notFoundDetails));
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

async function getLibraryWorkflowDescendantCategoryIds(
  client: ContextSnapshotClient,
  warnings: string[],
): Promise<Set<string>> {
  try {
    const list = await client.listCategories("WorkflowCategory");
    const categories = list.link ?? [];
    const libraryRoots = categories.filter(isLibraryCategoryRoot);
    if (libraryRoots.length === 0) {
      warnings.push(
        "workflows: no WorkflowCategory named Library was found; built-ins profile will only match workflow categoryName path metadata",
      );
      return new Set();
    }
    const rootPaths = libraryRoots.map(normalizeCategoryPath).filter(Boolean);
    const descendantCategoryIds = new Set(
      categories
        .filter((category) => isLibraryDescendantCategory(category, rootPaths))
        .map((category) => category.id),
    );
    if (descendantCategoryIds.size === 0) {
      const inferredIds = inferLibraryDescendantCategoryIds(categories, libraryRoots);
      if (inferredIds.size > 0) {
        return inferredIds;
      }
      warnings.push(
        "workflows: no Library descendant WorkflowCategory paths were found and category list order could not infer descendants; built-ins profile will only match workflow categoryName path metadata",
      );
    }
    return descendantCategoryIds;
  } catch (error) {
    warnings.push(
      `workflows: failed to discover Library workflow categories: ${formatError(error)}`,
    );
    return new Set();
  }
}

function isLibraryWorkflow(
  workflow: Workflow,
  libraryCategoryIds: Set<string>,
): boolean {
  if (workflow.categoryId && libraryCategoryIds.has(workflow.categoryId)) {
    return true;
  }
  return isLibraryCategoryName(workflow.categoryName);
}

function isLibraryDescendantCategory(
  category: Category,
  rootPaths: string[],
): boolean {
  const path = normalizeCategoryPath(category);
  return rootPaths.some(
    (rootPath) => path.startsWith(`${rootPath}/`),
  );
}

function inferLibraryDescendantCategoryIds(
  categories: Category[],
  libraryRoots: Category[],
): Set<string> {
  const libraryRootIds = new Set(libraryRoots.map((category) => category.id));
  const firstLibraryIndex = categories.findIndex((category) =>
    libraryRootIds.has(category.id),
  );
  if (firstLibraryIndex < 0) return new Set();

  const ids = new Set<string>();
  for (const category of categories.slice(firstLibraryIndex + 1)) {
    if (category.name === "web-root") break;
    ids.add(category.id);
  }
  return ids;
}

function isLibraryCategoryRoot(category: Category): boolean {
  return category.name === "Library" || normalizeCategoryPath(category) === "/Library";
}

function normalizeCategoryPath(category: Category): string {
  const path = category.path?.trim();
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function isLibraryCategoryName(categoryName?: string): boolean {
  if (!categoryName) return false;
  const normalized = categoryName.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.startsWith("Library/");
}

function isVmwareActionModule(moduleName?: string): boolean {
  return moduleName === "com.vmware" || moduleName?.startsWith("com.vmware.") === true;
}

function actionDetailReference(action: Action): string | undefined {
  if (action.module && action.name) return `${action.module}/${action.name}`;
  return action.fqn || action.id;
}

function builtInActionDetailReference(action: Action): string | undefined {
  return action.id || actionDetailReference(action);
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
    `Profile: ${snapshot.profile}`,
    `Domains: ${snapshot.domains.join(", ")}`,
    `Max items per domain: ${snapshot.limits.maxItemsPerDomain}`,
    "",
  ];

  if (snapshot.criteria && Object.keys(snapshot.criteria).length > 0) {
    lines.push("## Criteria", "");
    for (const [domain, criteria] of Object.entries(snapshot.criteria)) {
      lines.push(`- ${domain}: ${criteria}`);
    }
    lines.push("");
  }

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
  contextDir?: string,
): Promise<string> {
  return resolveFileInDirectory(
    contextDir ?? client.getContextDirectory(),
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
  profile: ContextSnapshotProfile = "default",
): ContextSnapshotDomain[] {
  const domains = requested?.length
    ? requested
    : profile === "vcfaBuiltIns"
      ? (["workflows", "actions"] satisfies ContextSnapshotDomain[])
      : [...CORE_DOMAINS];
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

function profileCriteria(
  profile: ContextSnapshotProfile,
): Record<string, string> | undefined {
  if (profile !== "vcfaBuiltIns") return undefined;
  return {
    workflows: "WorkflowCategory paths below Library",
    actions: "module is com.vmware or starts with com.vmware.",
  };
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

function isNotFoundError(error: unknown): boolean {
  return /\b404\b/.test(formatError(error));
}

function formatAggregatedNotFoundWarning<TListItem>(
  domain: string,
  details: { id: string; item: TListItem }[],
): string {
  const modules = uniqueSorted(
    details
      .map(({ item }) => (item as Record<string, unknown>).module)
      .filter((moduleName): moduleName is string => typeof moduleName === "string"),
  );
  const examples = modules.length > 0 ? modules : details.map(({ id }) => id);
  const suffix =
    examples.length > 0
      ? ` Examples: ${examples.slice(0, 5).join(", ")}${examples.length > 5 ? ", ..." : ""}.`
      : "";
  return `${domain}: detail lookup returned 404 for ${details.length} VMware built-in item(s); list-level metadata was retained.${suffix} This usually means the instance advertises optional plugin modules whose detail endpoint is unavailable.`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
