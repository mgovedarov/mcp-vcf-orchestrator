import type {
  Action,
  ActionList,
  CatalogItem,
  CatalogItemList,
  Category,
  CategoryList,
  ConfigElement,
  ConfigElementList,
  Deployment,
  DeploymentList,
  EventTopicList,
  SimpleParameter,
  Subscription,
  SubscriptionList,
  Template,
  TemplateList,
  VroClientConfig,
  Workflow,
  WorkflowExecution,
  WorkflowList
} from "./types.js";

/**
 * HTTP client for VCF Automation Orchestrator 8.x REST API.
 * Uses native fetch() (Node 18+).
 *
 * Authentication: obtains a bearer token from the VCF Cloud API sessions
 * endpoint (POST /cloudapi/1.0.0/sessions) before the first API call, and
 * caches it for the lifetime of the process.
 */
export class VroClient {
  private baseUrl: string;
  private eventBrokerBaseUrl: string;
  private catalogBaseUrl: string;
  private deploymentBaseUrl: string;
  private blueprintBaseUrl: string;
  private sessionUrl: string;
  private loginHeader: string;
  private token: string | null = null;

  constructor(private config: VroClientConfig) {
    this.baseUrl = `https://${config.host}/vco/api`;
    this.eventBrokerBaseUrl = `https://${config.host}/event-broker/api`;
    this.catalogBaseUrl = `https://${config.host}/catalog/api`;
    this.deploymentBaseUrl = `https://${config.host}/deployment/api`;
    this.blueprintBaseUrl = `https://${config.host}/blueprint/api`;
    this.sessionUrl = `https://${config.host}/cloudapi/1.0.0/sessions`;
    // Basic Auth credential: username@organization:password
    this.loginHeader =
      "Basic " +
      Buffer.from(
        `${config.username}@${config.organization}:${config.password}`
      ).toString("base64");
  }

  /** Obtain a bearer token from the VCF sessions endpoint. */
  private async authenticate(): Promise<void> {
    console.error("[vro-client] Authenticating via VCF Cloud API sessions…");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    let res: Response;
    try {
      res = await fetch(this.sessionUrl, {
        method: "POST",
        headers: {
          Authorization: this.loginHeader,
          "Content-Type": "application/json;version=9.0.0",
          Accept: "application/json;version=9.0.0",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `VCF authentication failed: ${res.status} ${res.statusText}\n${text}`
      );
    }

    const token = res.headers.get("x-vmware-vcloud-access-token");
    if (!token) {
      throw new Error(
        "VCF authentication succeeded but x-vmware-vcloud-access-token header was missing"
      );
    }

    this.token = token;
    console.error("[vro-client] Authentication successful, token acquired.");
  }

  // --- HTTP helpers ---

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    overrideBaseUrl?: string
  ): Promise<T> {
    if (!this.token) {
      await this.authenticate();
    }

    const url = `${overrideBaseUrl ?? this.baseUrl}${path}`;
    console.error(`[vro-client] ${method} ${path}`);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vRO API error: ${res.status} ${res.statusText} — ${method} ${path}\n${text}`
      );
    }

    // Some endpoints return 202 Accepted with a Location header and no body,
    // or 204 No Content. Handle both gracefully.
    const contentLength = res.headers.get("content-length");
    const hasBody = res.status !== 204 && contentLength !== "0";

    if (!hasBody) {
      // Extract ID from Location header if present (e.g. POST /executions)
      const location = res.headers.get("location");
      if (location) {
        const id = location.split("/").pop() ?? "";
        return { id, state: "running" } as T;
      }
      return {} as T;
    }

    return (await res.json()) as T;
  }

  private get<T>(path: string, overrideBaseUrl?: string): Promise<T> {
    return this.request<T>("GET", path, undefined, overrideBaseUrl);
  }

  private post<T>(path: string, body?: unknown, overrideBaseUrl?: string): Promise<T> {
    return this.request<T>("POST", path, body, overrideBaseUrl);
  }

  private put<T>(path: string, body?: unknown, overrideBaseUrl?: string): Promise<T> {
    return this.request<T>("PUT", path, body, overrideBaseUrl);
  }

  private del<T>(path: string, overrideBaseUrl?: string): Promise<T> {
    return this.request<T>("DELETE", path, undefined, overrideBaseUrl);
  }

  /**
   * The VRO list endpoints return items where metadata is stored in an
   * `attributes: [{name, value}]` array rather than as direct properties.
   * This helper converts that array to a plain key→value object.
   */
  private parseAttrs(
    attrs: { name: string; value: string }[] | undefined
  ): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const a of attrs ?? []) {
      obj[a.name] = a.value;
    }
    return obj;
  }

  // --- Workflows ---

  async listWorkflows(filter?: string): Promise<WorkflowList> {
    let path = "/workflows";
    const params: string[] = [];
    if (filter) {
      params.push(`conditions=name~${encodeURIComponent(filter)}`);
    }
    if (params.length > 0) {
      path += `?${params.join("&")}`;
    }
    const raw = await this.get<{ link?: { attributes?: { name: string; value: string }[] }[]; total?: number }>(path);
    const link: Workflow[] = (raw.link ?? []).map((item) => {
      const a = this.parseAttrs(item.attributes);
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

  async getWorkflow(id: string): Promise<Workflow> {
    return this.get<Workflow>(`/workflows/${encodeURIComponent(id)}`);
  }

  async createWorkflow(
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
    return this.post<Workflow>("/workflows", body);
  }

  async runWorkflow(
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
    return this.post<WorkflowExecution>(
      `/workflows/${encodeURIComponent(id)}/executions`,
      body
    );
  }

  async getWorkflowExecution(
    workflowId: string,
    executionId: string
  ): Promise<WorkflowExecution> {
    return this.get<WorkflowExecution>(
      `/workflows/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(executionId)}`
    );
  }

  async deleteWorkflow(id: string): Promise<void> {
    await this.del<unknown>(`/workflows/${encodeURIComponent(id)}`);
  }

  // --- Actions ---

  async listActions(filter?: string): Promise<ActionList> {
    let path = "/actions";
    const params: string[] = [];
    if (filter) {
      params.push(`conditions=name~${encodeURIComponent(filter)}`);
    }
    if (params.length > 0) {
      path += `?${params.join("&")}`;
    }
    const raw = await this.get<{ link?: { attributes?: { name: string; value: string }[] }[]; total?: number }>(path);
    const link: Action[] = (raw.link ?? []).map((item) => {
      const a = this.parseAttrs(item.attributes);
      return {
        id: a["id"] ?? a["@id"],
        name: a["name"] ?? a["@name"],
        description: a["description"],
        module: a["module"] ?? a["fqn"]?.split(".").slice(0, -1).join(".") ?? "",
        version: a["version"],
        fqn: a["fqn"],
      };
    });
    return { total: raw.total ?? link.length, link };
  }

  async getAction(id: string): Promise<Action> {
    return this.get<Action>(`/actions/${encodeURIComponent(id)}`);
  }

  async createAction(params: {
    moduleName: string;
    name: string;
    script: string;
    inputParameters?: { name: string; type: string; description?: string }[];
    returnType?: string;
  }): Promise<Action> {
    const body: Record<string, unknown> = {
      name: params.name,
      module: params.moduleName,
      script: params.script,
    };
    if (params.returnType) {
      body["output-type"] = params.returnType;
    }
    if (params.inputParameters && params.inputParameters.length > 0) {
      body["input-parameters"] = params.inputParameters.map((p) => ({
        name: p.name,
        type: p.type,
        description: p.description ?? "",
      }));
    }
    return this.post<Action>("/actions", body);
  }

  async deleteAction(id: string): Promise<void> {
    await this.del<unknown>(`/actions/${encodeURIComponent(id)}`);
  }

  // --- Configuration Elements ---

  async listConfigurations(filter?: string): Promise<ConfigElementList> {
    let path = "/configurations";
    const params: string[] = [];
    if (filter) {
      params.push(`conditions=name~${encodeURIComponent(filter)}`);
    }
    if (params.length > 0) {
      path += `?${params.join("&")}`;
    }
    const raw = await this.get<{ link?: { attributes?: { name: string; value: string }[] }[]; total?: number }>(path);
    const link: ConfigElement[] = (raw.link ?? []).map((item) => {
      const a = this.parseAttrs(item.attributes);
      return {
        id: a["id"] ?? a["@id"],
        name: a["name"] ?? a["@name"],
        description: a["description"],
        version: a["version"],
        categoryId: a["categoryId"],
      };
    });
    return { total: raw.total ?? link.length, link };
  }

  async getConfiguration(id: string): Promise<ConfigElement> {
    return this.get<ConfigElement>(
      `/configurations/${encodeURIComponent(id)}`
    );
  }

  async createConfiguration(
    categoryId: string,
    name: string,
    description?: string,
    attributes?: { name: string; type: string; value?: string }[]
  ): Promise<ConfigElement> {
    const body: Record<string, unknown> = {
      name,
      "category-id": categoryId,
    };
    if (description) {
      body.description = description;
    }
    if (attributes && attributes.length > 0) {
      body.attributes = attributes.map((a) => ({
        name: a.name,
        type: a.type,
        value: a.value
          ? { [a.type]: { value: a.value } }
          : undefined,
      }));
    }
    return this.post<ConfigElement>("/configurations", body);
  }

  async deleteConfiguration(id: string): Promise<void> {
    await this.del<unknown>(`/configurations/${encodeURIComponent(id)}`);
  }

  // --- Categories ---

  async listCategories(
    categoryType: string,
    filter?: string
  ): Promise<CategoryList> {
    let path = "/categories";
    const params: string[] = [`categoryType=${encodeURIComponent(categoryType)}`];
    if (filter) {
      params.push(`conditions=name~${encodeURIComponent(filter)}`);
    }
    path += `?${params.join("&")}`;
    const raw = await this.get<{ link?: { attributes?: { name: string; value: string }[] }[]; total?: number }>(path);
    const link: Category[] = (raw.link ?? []).map((item) => {
      const a = this.parseAttrs(item.attributes);
      return {
        id: a["id"] ?? a["@id"],
        name: a["name"] ?? a["@name"],
        description: a["description"],
        type: a["type"] ?? categoryType,
        path: a["path"],
      };
    });
    return { total: raw.total ?? link.length, link };
  }

  // --- Extensibility Subscriptions (Event Broker) ---

  async listSubscriptions(projectId?: string): Promise<SubscriptionList> {
    let path = "/subscriptions";
    if (projectId) {
      path += `?$filter=projectId eq '${encodeURIComponent(projectId)}'`;
    }
    return this.get<SubscriptionList>(path, this.eventBrokerBaseUrl);
  }

  async getSubscription(id: string): Promise<Subscription> {
    return this.get<Subscription>(
      `/subscriptions/${encodeURIComponent(id)}`,
      this.eventBrokerBaseUrl
    );
  }

  async createSubscription(params: {
    name: string;
    eventTopicId: string;
    runnableType: string;
    runnableId: string;
    projectId?: string;
    description?: string;
    blocking?: boolean;
    priority?: number;
    timeout?: number;
    disabled?: boolean;
    constraints?: Record<string, unknown>;
  }): Promise<Subscription> {
    const body: Record<string, unknown> = {
      name: params.name,
      type: "RUNNABLE",
      eventTopicId: params.eventTopicId,
      runnableType: params.runnableType,
      runnableId: params.runnableId,
    };
    if (params.projectId !== undefined) body.projectId = params.projectId;
    if (params.description !== undefined) body.description = params.description;
    if (params.blocking !== undefined) body.blocking = params.blocking;
    if (params.priority !== undefined) body.priority = params.priority;
    if (params.timeout !== undefined) body.timeout = params.timeout;
    if (params.disabled !== undefined) body.disabled = params.disabled;
    if (params.constraints !== undefined) body.constraints = params.constraints;
    return this.post<Subscription>("/subscriptions", body, this.eventBrokerBaseUrl);
  }

  async updateSubscription(
    id: string,
    params: {
      name?: string;
      description?: string;
      disabled?: boolean;
      runnableId?: string;
      runnableType?: string;
      blocking?: boolean;
      priority?: number;
      timeout?: number;
      constraints?: Record<string, unknown>;
    }
  ): Promise<Subscription> {
    return this.put<Subscription>(
      `/subscriptions/${encodeURIComponent(id)}`,
      params,
      this.eventBrokerBaseUrl
    );
  }

  async deleteSubscription(id: string): Promise<void> {
    await this.del<unknown>(
      `/subscriptions/${encodeURIComponent(id)}`,
      this.eventBrokerBaseUrl
    );
  }

  // --- Event Topics (Event Broker) ---

  async listEventTopics(): Promise<EventTopicList> {
    return this.get<EventTopicList>("/topics", this.eventBrokerBaseUrl);
  }

  // --- Catalog Items (Service Broker) ---

  async listCatalogItems(search?: string): Promise<CatalogItemList> {
    let path = "/items";
    if (search) {
      path += `?$search=${encodeURIComponent(search)}`;
    }
    return this.get<CatalogItemList>(path, this.catalogBaseUrl);
  }

  async getCatalogItem(id: string): Promise<CatalogItem> {
    return this.get<CatalogItem>(
      `/items/${encodeURIComponent(id)}`,
      this.catalogBaseUrl
    );
  }

  // --- Deployments ---

  async listDeployments(search?: string, projectId?: string): Promise<DeploymentList> {
    const params: string[] = [];
    if (search) {
      params.push(`$search=${encodeURIComponent(search)}`);
    }
    if (projectId) {
      params.push(`projectId=${encodeURIComponent(projectId)}`);
    }
    const path = params.length > 0 ? `/deployments?${params.join("&")}` : "/deployments";
    return this.get<DeploymentList>(path, this.deploymentBaseUrl);
  }

  async getDeployment(id: string): Promise<Deployment> {
    return this.get<Deployment>(
      `/deployments/${encodeURIComponent(id)}`,
      this.deploymentBaseUrl
    );
  }

  async deleteDeployment(id: string): Promise<void> {
    await this.del<unknown>(
      `/deployments/${encodeURIComponent(id)}`,
      this.deploymentBaseUrl
    );
  }

  // --- Blueprint Templates (Cloud Assembly) ---

  async listTemplates(search?: string, projectId?: string): Promise<TemplateList> {
    const params: string[] = [];
    if (search) {
      params.push(`$search=${encodeURIComponent(search)}`);
    }
    if (projectId) {
      params.push(`projectId=${encodeURIComponent(projectId)}`);
    }
    const path = params.length > 0 ? `/blueprints?${params.join("&")}` : "/blueprints";
    return this.get<TemplateList>(path, this.blueprintBaseUrl);
  }

  async getTemplate(id: string): Promise<Template> {
    return this.get<Template>(
      `/blueprints/${encodeURIComponent(id)}`,
      this.blueprintBaseUrl
    );
  }

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
    if (params.requestScopeOrg !== undefined) body.requestScopeOrg = params.requestScopeOrg;
    return this.post<Template>("/blueprints", body, this.blueprintBaseUrl);
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.del<unknown>(
      `/blueprints/${encodeURIComponent(id)}`,
      this.blueprintBaseUrl
    );
  }

  async createDeploymentFromCatalogItem(params: {
    catalogItemId: string;
    deploymentName: string;
    projectId: string;
    version?: string;
    reason?: string;
    inputs?: Record<string, unknown>;
  }): Promise<Deployment> {
    const body: Record<string, unknown> = {
      deploymentName: params.deploymentName,
      projectId: params.projectId,
    };
    if (params.version !== undefined) body.version = params.version;
    if (params.reason !== undefined) body.reason = params.reason;
    if (params.inputs !== undefined) body.inputs = params.inputs;
    return this.post<Deployment>(
      `/items/${encodeURIComponent(params.catalogItemId)}/request`,
      body,
      this.catalogBaseUrl
    );
  }
}
