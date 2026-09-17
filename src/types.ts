// TypeScript interfaces for VCF Automation Orchestrator REST API responses

/** vRO parameter (used in workflow inputs/outputs, config attributes, action params) */
export interface VroParameter {
  name: string;
  type: string;
  value?: {
    string?: { value: string };
    number?: { value: number };
    boolean?: { value: boolean };
    [key: string]: unknown;
  };
  description?: string;
}

/** Simplified parameter for tool input (user-facing) */
export interface SimpleParameter {
  name: string;
  type: string;
  value?: unknown;
}

// --- Workflows ---

export interface WorkflowLink {
  rel: string;
  href: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  version?: string;
  categoryId?: string;
  categoryName?: string;
  customizedIcon?: string;
  "input-parameters"?: VroParameter[];
  "output-parameters"?: VroParameter[];
  inputParameters?: VroParameter[];
  outputParameters?: VroParameter[];
  href?: string;
  relations?: {
    link: WorkflowLink[];
  };
}

export interface WorkflowList {
  total?: number;
  start?: number;
  link: Workflow[];
  /** Present (true) when server-side pagination stopped at the page-request cap. */
  truncated?: boolean;
  limited?: boolean;
}

export interface ListWorkflowsByCategoryParams {
  categoryId?: string;
  categoryName?: string;
  categoryPath?: string;
  includeEmptyCategories?: boolean;
  maxCategories?: number;
}

export interface WorkflowCategoryGroup {
  category: Category;
  workflows: Workflow[];
}

export interface WorkflowsByCategoryResult {
  rootCategory: Category;
  categories: WorkflowCategoryGroup[];
  workflowCount: number;
  truncated?: boolean;
}

export interface WorkflowArtifactParameter {
  name: string;
  type: string;
  description?: string;
}

export interface WorkflowArtifactBinding {
  name: string;
  type: string;
  source?: string;
  target?: string;
}

export interface WorkflowActionTaskInput {
  name: string;
  type: string;
  source: string;
}

export interface WorkflowActionTaskResult {
  name: string;
  type: string;
}

export interface WorkflowArtifactTask {
  name?: string;
  displayName?: string;
  description?: string;
  /**
   * Task kind. "script" (default) renders a scriptable task from `script`.
   * "action" renders a native vRO action workflow item from `module`/`actionName`.
   */
  kind?: "script" | "action";
  /** Scriptable task body. Required for `kind: "script"` (the default). */
  script?: string;
  inBindings?: WorkflowArtifactBinding[];
  outBindings?: WorkflowArtifactBinding[];
  /** Native action module name, e.g. com.example.actions. Required for `kind: "action"`. */
  module?: string;
  /** Native action name. Required for `kind: "action"`. */
  actionName?: string;
  /** Ordered action inputs mapped from workflow inputs/attributes. Used for `kind: "action"`. */
  inputs?: WorkflowActionTaskInput[];
  /**
   * Workflow output/attribute that receives the action's return value (bound from `actionResult`).
   * Omit for actions with no return value. Used for `kind: "action"`.
   */
  resultBinding?: WorkflowActionTaskResult;
}

export interface WorkflowArtifactSpec {
  id?: string;
  name: string;
  description?: string;
  version?: string;
  apiVersion?: string;
  inputs?: WorkflowArtifactParameter[];
  outputs?: WorkflowArtifactParameter[];
  attributes?: WorkflowArtifactParameter[];
  tasks: WorkflowArtifactTask[];
}

export interface ScaffoldWorkflowFileParams {
  fileName: string;
  overwrite?: boolean;
  workflow: WorkflowArtifactSpec;
}

export type WorkflowDiffSource =
  | { source: "file"; fileName: string }
  | { source: "live"; workflowId: string };

export interface DiffWorkflowFileParams {
  base: WorkflowDiffSource;
  compare: WorkflowDiffSource;
}

export interface WorkflowExecutionState {
  value: string; // "running" | "completed" | "failed" | "canceled" | "waiting"
}

export interface WorkflowExecution {
  id: string;
  state: string;
  "start-date"?: string;
  "end-date"?: string;
  "started-by"?: string;
  "business-state"?: string;
  "content-exception"?: string;
  "current-item-display-name"?: string;
  "current-item-for-display"?: string;
  "output-parameters"?: VroParameter[];
  outputParameters?: VroParameter[];
  "execution-stack"?: WorkflowExecutionStackItem[];
  executionStack?: WorkflowExecutionStackItem[];
  "workflow-item"?: WorkflowExecutionStackItem[];
  workflowItem?: WorkflowExecutionStackItem[];
  href?: string;
  name?: string;
}

export interface WorkflowExecutionStackItem {
  name?: string;
  displayName?: string;
  workflowDisplayName?: string;
  href?: string;
  parameter?: VroParameter[];
  attributes?: VroParameter[];
  "workflow-attributes"?: VroParameter[];
}

export interface WorkflowExecutionList {
  total?: number;
  relations?: {
    link: WorkflowExecution[];
  };
}

export interface WorkflowExecutionLog {
  [key: string]: unknown;
  severity?: string;
  userName?: string;
  user?: string;
  origin?: string;
  message?: string;
  msg?: string;
  description?: string;
  shortDescription?: string;
  longDescription?: string;
  timeStamp?: string;
  timeStampVal?: number;
  "short-description"?: string;
  "long-description"?: string;
  "time-stamp"?: string;
  "time-stamp-val"?: number;
  attributes?: { name: string; value: string }[];
  attribute?: { name: string; value: string }[];
}

export interface WorkflowExecutionLogs {
  logs?: WorkflowExecutionLog[];
}

export type WorkflowExecutionLogLevel = "debug" | "info" | "error";

export type WorkflowExecutionLogExportFormat = "json" | "text";

export interface ExportWorkflowExecutionLogsParams {
  workflowId: string;
  executionId: string;
  fileName: string;
  level?: WorkflowExecutionLogLevel;
  format?: WorkflowExecutionLogExportFormat;
  maxResult?: number;
  overwrite?: boolean;
}

export interface ExportWorkflowExecutionLogsResult {
  path: string;
  level: WorkflowExecutionLogLevel;
  format: WorkflowExecutionLogExportFormat;
  fetchedCount: number;
  exportedCount: number;
}

// --- Actions ---

export interface Action {
  id: string;
  name: string;
  description?: string;
  module: string;
  version?: string;
  fqn?: string;
  script?: string;
  "input-parameters"?: VroParameter[];
  "output-type"?: string;
  href?: string;
}

export interface ActionList {
  total?: number;
  start?: number;
  link: Action[];
  /** Present (true) when server-side pagination stopped at the page-request cap. */
  truncated?: boolean;
  limited?: boolean;
}

export type ActionDiffSource =
  | { source: "file"; fileName: string }
  | { source: "live"; actionId: string };

export interface DiffActionFileParams {
  base: ActionDiffSource;
  compare: ActionDiffSource;
}

// --- Artifact promotion ---

export type ArtifactPromotionKind =
  | "workflow"
  | "action"
  | "configuration"
  | "package";

export interface ArtifactPromotionTarget {
  categoryId?: string;
  categoryName?: string;
  workflowId?: string;
  actionId?: string;
  configurationId?: string;
  packageName?: string;
}

export interface ArtifactPromotionBackup {
  enabled: boolean;
  fileName?: string;
  overwrite?: boolean;
}

export interface PrepareArtifactPromotionParams {
  kind: ArtifactPromotionKind;
  fileName: string;
  target?: ArtifactPromotionTarget;
  overwrite?: boolean;
  backup?: ArtifactPromotionBackup;
}

// --- Configuration Elements ---

export interface ConfigAttribute {
  name: string;
  type: string;
  value?: {
    string?: { value: string };
    number?: { value: number };
    boolean?: { value: boolean };
    [key: string]: unknown;
  };
  description?: string;
}

export interface ConfigElement {
  id: string;
  name: string;
  description?: string;
  version?: string;
  categoryId?: string;
  href?: string;
  attributes?: ConfigAttribute[];
}

export interface ConfigElementList {
  total?: number;
  start?: number;
  link: ConfigElement[];
  /** Present (true) when server-side pagination stopped at the page-request cap. */
  truncated?: boolean;
  limited?: boolean;
}

// --- Categories ---

export interface Category {
  id: string;
  name: string;
  description?: string;
  type: string;
  path?: string;
  parentId?: string;
  parentName?: string;
  parentPath?: string;
  href?: string;
}

export interface CategoryList {
  total?: number;
  start?: number;
  link: Category[];
  /** Present (true) when server-side pagination stopped at the page-request cap. */
  truncated?: boolean;
  limited?: boolean;
}

// --- Extensibility Subscriptions (Event Broker) ---

export interface Subscription {
  id: string;
  /**
   * Optional: vRA 8 serves system subscriptions with no name at all (verified
   * on vRA 8.18, VCFO-070), so renderers must not interpolate it unguarded.
   */
  name?: string;
  description?: string;
  type?: string; // e.g. "RUNNABLE"
  disabled?: boolean;
  eventTopicId?: string;
  runnableType?: string; // "extensibility.vro" | "extensibility.abx"
  runnableId?: string;
  constraints?: Record<string, unknown>;
  blocking?: boolean;
  priority?: number;
  timeout?: number;
  projectId?: string;
  orgId?: string;
  selfLink?: string;
}

export interface SubscriptionList {
  content: Subscription[];
  totalElements?: number;
  numberOfElements?: number;
  /** Present (true) when server-side pagination stopped at the page-request cap. */
  truncated?: boolean;
  limited?: boolean;
}

// --- Event Topics (Event Broker) ---

export interface EventTopic {
  id: string;
  name: string;
  description?: string;
  blockable?: boolean;
  schema?: Record<string, unknown>;
}

export interface EventTopicList {
  content: EventTopic[];
  totalElements?: number;
  numberOfElements?: number;
  /** Present (true) when server-side pagination stopped at the page-request cap. */
  truncated?: boolean;
  limited?: boolean;
}

// --- Catalog Items (Service Broker) ---

export interface CatalogItemType {
  id: string;
  name: string;
}

export interface CatalogItem {
  id: string;
  /**
   * Optional for the same reason `Subscription.name` is (VCFO-070): a renderer
   * must not interpolate it unguarded. A released blueprint-backed item carries
   * one on VCFA 9.1 (VCFO-074) and on vRA 8.18 (VCFO-088) alike, so the guard
   * is provision for shapes not yet seen rather than a fix for a known gap.
   */
  name?: string;
  description?: string;
  type?: CatalogItemType;
  /**
   * Neither field is served for a blueprint-backed item on VCFA 9.1 or on
   * vRA 8.18, both of which identify its origin through `type.id`
   * (`com.vmw.blueprint`) (VCFO-074, VCFO-088). They are kept because a
   * content-source-backed item may still carry them.
   */
  sourceType?: string;
  sourceName?: string;
  sourceId?: string;
  projectIds?: string[];
  /**
   * The project the item's source lives in, served by a blueprint-backed item
   * on VCFA 9.1 alongside `projectIds` (VCFO-074). Not served by vRA 8.18,
   * which carries `projectIds` only (VCFO-088).
   */
  sourceProjectId?: string;
  iconId?: string;
  createdAt?: string;
  createdBy?: string;
  lastUpdatedAt?: string;
  lastUpdatedBy?: string;
  requestScopeOrg?: boolean;
  /**
   * The request schema: what `create-deployment` must be given as `inputs`.
   * Observed on VCFA 9.1 as a JSON-Schema-shaped object with `properties` and
   * `required` (VCFO-074), and on vRA 8.18 in the same shape -- with both
   * empty for a blueprint that declares no inputs (VCFO-088). Without it an
   * agent cannot discover the item's inputs through the tool surface and would
   * have to guess them.
   */
  schema?: CatalogItemSchema;
  /**
   * 0 on a 9.1 blueprint-backed item, meaning bulk requests are not offered;
   * 1 on the vRA 8.18 item (VCFO-088).
   */
  bulkRequestLimit?: number;
  /** `/blueprint/api/blueprints/<id>` for a blueprint-backed item on 9.1. */
  externalId?: string;
  /** Served by VCFA 9.1; absent from the vRA 8.18 item (VCFO-088). */
  global?: boolean;
  /**
   * Served by VCFA 9.1; absent from the vRA 8.18 item, so `get-catalog-item`
   * prints no `Requestable:` line there (VCFO-088).
   */
  isRequestable?: boolean;
}

/**
 * A catalog item's request schema, as served by VCFA 9.1 (VCFO-074).
 *
 * Deliberately permissive: this mirrors a JSON Schema subset the service
 * composes from the blueprint's inputs, and an unmodelled keyword must survive
 * a round trip rather than be dropped.
 */
export interface CatalogItemSchema {
  type?: string;
  encrypted?: boolean;
  properties?: Record<string, CatalogItemSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

export interface CatalogItemSchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  /**
   * Present on a value the service stores encrypted. Renderers must not print
   * this property's `default` or any example value when it is true.
   */
  encrypted?: boolean;
  default?: unknown;
  pattern?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  [key: string]: unknown;
}

export interface CatalogItemList {
  content: CatalogItem[];
  totalElements?: number;
  numberOfElements?: number;
  /** Present (true) when server-side pagination stopped at the page-request cap. */
  truncated?: boolean;
  limited?: boolean;
}

// --- Deployments ---

export interface Deployment {
  id: string;
  /**
   * Observed on VCFA 9.1 (VCFO-074), but kept optional: one lab is not a
   * contract, and the renderers must not interpolate it unguarded.
   */
  name?: string;
  /**
   * Served on 9.1 and vRA 8.18 only when set -- the create request's `reason`
   * becomes it.
   */
  description?: string;
  /**
   * Observed values on VCFA 9.1 and vRA 8.18 alike: `CREATE_INPROGRESS`,
   * `CREATE_SUCCESSFUL`, `DELETE_INPROGRESS`, then 404. Note `INPROGRESS`
   * carries no underscore, so do not match on `IN_PROGRESS`. A day-2 action
   * does not move it: a deployment read `CREATE_SUCCESSFUL` throughout a
   * PowerOff and a PowerOn on vRA 8.18, so an action's progress lives on its
   * `DeploymentRequest`, not here (VCFO-074, VCFO-088). The full vocabulary is
   * wider than what these rounds exercised.
   */
  status?: string;
  projectId?: string;
  /**
   * NOT served by VCFA 9.1 or vRA 8.18, both of which carry only `projectId`
   * (VCFO-074, VCFO-088). Guards comparing an expected project name against
   * this field directly refuse every call; resolve the name through the
   * project service instead.
   */
  projectName?: string;
  catalogItemId?: string;
  catalogItemVersion?: string;
  ownedBy?: string;
  createdAt?: string;
  createdBy?: string;
  lastUpdatedAt?: string;
  lastUpdatedBy?: string;
  /** The inputs the deployment was requested with, keyed by input name. */
  inputs?: Record<string, unknown>;
  /** Observed on 9.1: the blueprint behind the requested catalog item version. */
  blueprintId?: string;
  blueprintVersion?: string;
  orgId?: string;
  /** Observed on 9.1 as `USER`. */
  ownerType?: string;
  leaseGracePeriodDays?: number;
  iconId?: string;
}

/**
 * One element of the response to `POST /catalog/api/items/{id}/request`.
 *
 * The route answers a **bare array** of these on VCFA 9.1 (VCFO-074) and on
 * vRA 8.18 (VCFO-088) alike, NOT a `Deployment`: the observed element carries
 * exactly `deploymentId` and `deploymentName` and neither `id`, `name` nor
 * `status`. Typing the response as a `Deployment` made `create-deployment`
 * print no identifiers at all.
 *
 * The `id`/`name` aliases are kept because a platform that answers with a
 * single request object is still plausible, and `normalizeCatalogItemRequest`
 * accepts either spelling.
 */
export interface CatalogItemRequestEntry {
  deploymentId?: string;
  deploymentName?: string;
  id?: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
}

/** Either arm: a bare array (observed on 9.1 and vRA 8.18) or a single object. */
export type CatalogItemRequestResponse =
  | CatalogItemRequestEntry[]
  | CatalogItemRequestEntry;

export interface DeploymentList {
  content: Deployment[];
  totalElements?: number;
  numberOfElements?: number;
  /** Present (true) when server-side pagination stopped at the page-request cap. */
  truncated?: boolean;
  limited?: boolean;
}

export interface DeploymentActionInput {
  name?: string;
  label?: string;
  type?: string;
  description?: string;
  required?: boolean;
  [key: string]: unknown;
}

export interface DeploymentAction {
  id: string;
  name?: string;
  displayName?: string;
  description?: string;
  /**
   * None of these three was served by VCFA 9.1 (VCFO-074) or by vRA 8.18
   * (VCFO-088): both serve action objects carrying exactly `id`, `name`,
   * `displayName`, `description`, `valid` and `actionType`, in a bare array.
   * So the three-way input handling below remains unobserved everywhere and
   * must not be assumed correct.
   */
  inputParameters?: DeploymentActionInput[];
  inputs?: DeploymentActionInput[] | Record<string, unknown>;
  formDefinition?: Record<string, unknown>;
  /** Observed on 9.1: whether the action can currently be requested. */
  valid?: boolean;
  /** Observed on 9.1 as `RESOURCE_ACTION` for every deployment-level action. */
  actionType?: string;
  [key: string]: unknown;
}

export interface DeploymentActionPage {
  content: DeploymentAction[];
  totalElements?: number;
  numberOfElements?: number;
}

export type DeploymentActionList = DeploymentAction[] | DeploymentActionPage;

export interface DeploymentActionRequestParams {
  deploymentId: string;
  actionId: string;
  reason?: string;
  inputs?: Record<string, unknown>;
}

/**
 * The request a deployment-service write queues: what `POST
 * /deployments/{id}/requests` and `DELETE /deployments/{id}` both answer 200
 * with on vRA 8.18 (VCFO-088) and on VCF Automation 9.1 (VCFO-095). Observed
 * keys: `id`, `name` (the action's display name, e.g. `Power Off`), `actionId`,
 * `deploymentId`, `requestedBy`, `status`, `details`, `createdAt`, `updatedAt`,
 * `totalTasks`, `completedTasks`, `resourceIds`, `cancelable` while it can
 * still be cancelled, and `approvedAt` once it has started. The same object is
 * read back by id from `GET /requests/{id}` (VCFO-094), verified live on both
 * platforms under VCFO-095.
 *
 * Status vocabulary observed there: `PENDING` -> `INITIALIZATION` ->
 * `CHECKING_APPROVAL` -> `INPROGRESS` -> `SUCCESSFUL`, and on 9.1 also
 * `COMPLETION` between the last two -- short-lived enough that a 2 s poll
 * caught it once in three requests, so its absence elsewhere is a sampling
 * result rather than a platform difference. `totalTasks` is a placeholder at submission
 * (`1` for a power action, `2` for a delete) that the service replaces once it
 * enumerates the tasks (4, 5, and 7 for a create), so progress is not
 * monotonic.
 *
 * A **create** request is the same object without an `actionId`, and carries
 * `blueprintId` and `catalogItemId` instead; on 9.1 it also carries the
 * `inputs` the deployment was requested with. `completedAt` has never been
 * served on either platform.
 */
export interface DeploymentRequest {
  id?: string;
  actionId?: string;
  deploymentId?: string;
  /** Served on a create request instead of `actionId` (VCFO-095). */
  blueprintId?: string;
  /** Served on a create request instead of `actionId` (VCFO-095). */
  catalogItemId?: string;
  name?: string;
  status?: string;
  details?: string;
  requestedBy?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  approvedAt?: string;
  cancelable?: boolean;
  totalTasks?: number;
  completedTasks?: number;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  resourceIds?: string[];
  resources?: {
    id?: string;
    name?: string;
    description?: string;
    version?: string;
  }[];
}

// --- Blueprint Templates (Cloud Assembly) ---

export interface Template {
  id: string;
  name: string;
  description?: string;
  content?: string;
  status?: string; // e.g. "DRAFT" | "VERSIONED" | "RELEASED"
  projectId?: string;
  projectName?: string;
  requestScopeOrg?: boolean;
  valid?: boolean;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface TemplateList {
  content: Template[];
  totalElements?: number;
  numberOfElements?: number;
  /** Present (true) when server-side pagination stopped at the page-request cap. */
  truncated?: boolean;
  limited?: boolean;
}

// --- Projects (project-service) ---

/**
 * A user or group granted a role on a project. The role arrays of the
 * project-service response hold these, and the two platforms name those
 * arrays differently — see `Project`. Both labs returned every array empty,
 * so the entry shape follows the public Project Service API (`email`, `type`
 * of `user` or `group`) and the renderer tolerates entries without either
 * field.
 */
export interface ProjectPrincipal {
  email?: string;
  type?: string;
}

/**
 * Project as served by `GET /project-service/api/projects[/{id}]`. Cloud zones
 * are not part of this view: they live on the IaaS `/iaas/api/projects`
 * resource.
 *
 * The two platforms serve different field sets, so this is a union and every
 * field beyond `id`/`name` is optional. Observed live under VCFO-065:
 *
 * - vRA 8.18 served `orgId`, `administrators`/`members`/`viewers`/
 *   `supervisors`, `constraints`, `properties`, `operationTimeout` and
 *   `sharedResources`.
 * - VCF Automation 9.1 served exactly `orgId` and a different set of role
 *   arrays — `administrators`/`advancedUsers`/`users`/`auditors`.
 *
 * Only `administrators` is common to the two, which is why the renderer prints
 * the known arrays that arrive and then any further array of principal-shaped
 * entries, rather than a fixed list of names. The 9.1 observation is one
 * project, auto-created and with every role array empty, so the absence of
 * `constraints`, `properties`, `operationTimeout` and `sharedResources` there
 * is what that response carried — not evidence that 9.x never serves them on a
 * project that sets them. Declaring the union costs nothing either way.
 */
export interface Project {
  id: string;
  /**
   * Optional for the same reason `CatalogItem.name` is (VCFO-074): a renderer
   * must not interpolate it unguarded. Every project on both labs carried one,
   * so this follows the convention rather than an observed gap.
   */
  name?: string;
  description?: string;
  /** Owning organization. */
  orgId?: string;
  /** Served by both platforms. */
  administrators?: ProjectPrincipal[];
  /** vRA 8 role arrays. */
  members?: ProjectPrincipal[];
  viewers?: ProjectPrincipal[];
  supervisors?: ProjectPrincipal[];
  /** VCF Automation 9.x role arrays. */
  advancedUsers?: ProjectPrincipal[];
  users?: ProjectPrincipal[];
  auditors?: ProjectPrincipal[];
  /** Placement constraints keyed by kind (network, storage, extensibility). */
  constraints?: Record<string, unknown>;
  /**
   * Project properties. `__namingTemplate` and `__projectPlacementPolicy`
   * carry the machine naming template and placement policy; any other key is
   * a custom property.
   */
  properties?: Record<string, unknown>;
  /** Request timeout in seconds. */
  operationTimeout?: number;
  sharedResources?: boolean;
}

export interface ProjectList {
  content: Project[];
  totalElements?: number;
  numberOfElements?: number;
  /** Present (true) when server-side pagination stopped at the page-request cap. */
  truncated?: boolean;
  limited?: boolean;
}

// --- vRO Packages ---

export interface VroPackage {
  name: string;
  description?: string;
  version?: string;
  href?: string;
  workflows?: unknown[];
  actions?: unknown[];
  configurations?: unknown[];
  resources?: unknown[];
  usedPlugins?: unknown[];
}

export interface VroPackageList {
  total?: number;
  link: VroPackage[];
  /** Present (true) when server-side pagination stopped at the page-request cap. */
  truncated?: boolean;
  limited?: boolean;
}

export interface ProjectPackageResult {
  name: string;
  created: boolean;
  package?: VroPackage;
}

export interface PackageImportDetails {
  packageName?: string;
  packageAlreadyExists?: boolean;
  contentVerified?: boolean;
  certificateValid?: boolean;
  certificateTrusted?: boolean;
  certificateUnknown?: boolean;
  importElementDetails?: unknown[];
  certificateInfo?: Record<string, unknown>;
}

export interface PackageExportOptions {
  exportConfigurationAttributeValues?: boolean;
  exportGlobalTags?: boolean;
  exportVersionHistory?: boolean;
  exportConfigSecureStringAttributeValues?: boolean;
}

export interface PackageImportOptions {
  overwrite?: boolean;
  importConfigurationAttributeValues?: boolean;
  tagImportMode?:
    | "DoNotImport"
    | "ImportAndOverwriteExistingValue"
    | "ImportButPreserveExistingValue";
  importConfigSecureStringAttributeValues?: boolean;
}

// --- Resource Elements ---

export interface ResourceElement {
  id: string;
  name: string;
  description?: string;
  version?: string;
  categoryId?: string;
  categoryName?: string;
  mimeType?: string;
  href?: string;
}

export interface ResourceElementList {
  total?: number;
  start?: number;
  link: ResourceElement[];
  /** Present (true) when server-side pagination stopped at the page-request cap. */
  truncated?: boolean;
  limited?: boolean;
}

// --- vRO Plugins ---

export interface VroPlugin {
  name: string;
  displayName?: string;
  version?: string;
  description?: string;
  type?: string;
  /**
   * Plugin state as reported by the flat vRA 8 plugin descriptor; undefined
   * when the endpoint does not expose it (VCF Automation 9.x listings).
   */
  enabled?: boolean;
}

export interface VroPluginList {
  total?: number;
  link: VroPlugin[];
  /** Present (true) when server-side pagination stopped at the page-request cap. */
  truncated?: boolean;
  limited?: boolean;
}

export interface ListOptions {
  limit?: number;
}

// --- Client config ---

export type VroTargetPlatform = "vcfa" | "vra8";

/**
 * Accepted targetPlatform configuration values. `vcfa` auto-negotiates the
 * VCF Cloud API version (9.1 preferred); `vcfa9.0`/`vcfa9.1` pin it
 * explicitly. All `vcfa*` values normalize to the `vcfa` platform.
 */
export type VroTargetPlatformInput =
  | VroTargetPlatform
  | "vcfa9.0"
  | "vcfa9.1";

export interface VroClientConfig {
  host: string;
  /**
   * Optional `host[:port]` of an external vRO appliance. Only the vRO
   * `/vco/api` base URL follows it; the logins, `GET /api/versions`, and the
   * Automation services stay on `host`. Unset, blank, or equal to `host`
   * means the vRO embedded in the Automation appliance (VCFO-081).
   */
  vroHost?: string;
  username: string;
  organization: string;
  password: string;
  targetPlatform?: VroTargetPlatformInput;
  ignoreTls?: boolean;
  artifactDir?: string;
  packageDir?: string;
  projectPackageName?: string;
  projectPackageDescription?: string;
  resourceDir?: string;
  workflowDir?: string;
  executionLogDir?: string;
  actionDir?: string;
  configurationDir?: string;
  contextDir?: string;
}
