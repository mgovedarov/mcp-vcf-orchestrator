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
  href?: string;
  relations?: {
    link: WorkflowLink[];
  };
}

export interface WorkflowList {
  total?: number;
  start?: number;
  link: Workflow[];
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
  "content-exception"?: string;
  "output-parameters"?: VroParameter[];
  href?: string;
  name?: string;
}

export interface WorkflowExecutionList {
  total?: number;
  relations?: {
    link: WorkflowExecution[];
  };
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
}

// --- Categories ---

export interface Category {
  id: string;
  name: string;
  description?: string;
  type: string;
  path?: string;
  href?: string;
}

export interface CategoryList {
  total?: number;
  start?: number;
  link: Category[];
}

// --- Extensibility Subscriptions (Event Broker) ---

export interface Subscription {
  id: string;
  name: string;
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
}

// --- Catalog Items (Service Broker) ---

export interface CatalogItemType {
  id: string;
  name: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  description?: string;
  type?: CatalogItemType;
  sourceType?: string;
  sourceName?: string;
  sourceId?: string;
  projectIds?: string[];
  iconId?: string;
  createdAt?: string;
  createdBy?: string;
  lastUpdatedAt?: string;
  lastUpdatedBy?: string;
  requestScopeOrg?: boolean;
}

export interface CatalogItemList {
  content: CatalogItem[];
  totalElements?: number;
  numberOfElements?: number;
}

// --- Deployments ---

export interface Deployment {
  id: string;
  name: string;
  description?: string;
  status?: string; // e.g. "CREATE_SUCCESSFUL" | "DELETE_IN_PROGRESS" | "UPDATE_FAILED" etc.
  projectId?: string;
  projectName?: string;
  catalogItemId?: string;
  catalogItemVersion?: string;
  ownedBy?: string;
  createdAt?: string;
  createdBy?: string;
  lastUpdatedAt?: string;
  lastUpdatedBy?: string;
}

export interface DeploymentList {
  content: Deployment[];
  totalElements?: number;
  numberOfElements?: number;
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
}

// --- vRO Packages ---

export interface VroPackage {
  name: string;
  description?: string;
  version?: string;
  href?: string;
}

export interface VroPackageList {
  total?: number;
  link: VroPackage[];
}

// --- Client config ---

export interface VroClientConfig {
  host: string;
  username: string;
  organization: string;
  password: string;
  ignoreTls?: boolean;
}
