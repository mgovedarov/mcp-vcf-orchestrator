import type {
  EventTopicList,
  ListOptions,
  Subscription,
  SubscriptionList,
} from "../types.js";
import { randomUUID } from "node:crypto";

import type { VroHttpClient } from "./core.js";
import { getAllAutomationPages } from "./pagination.js";

export class SubscriptionClient {
  constructor(private http: VroHttpClient) {}

  listSubscriptions(projectId?: string, options?: ListOptions): Promise<SubscriptionList> {
    const params = new URLSearchParams();
    if (projectId) {
      // Escape single quotes for OData string literal ('' is the OData escape for ').
      params.set("$filter", `projectId eq '${projectId.replace(/'/g, "''")}'`);
    }
    return getAllAutomationPages<Subscription>(
      this.http,
      "/subscriptions",
      this.http.eventBrokerBaseUrl,
      params,
      { maxItems: options?.limit },
    );
  }

  getSubscription(id: string): Promise<Subscription> {
    return this.http.get<Subscription>(
      `/subscriptions/${encodeURIComponent(id)}`,
      this.http.eventBrokerBaseUrl,
    );
  }

  /**
   * Fields a caller may set on a subscription, in the shape the API expects.
   * `id` is included because vRA 8 requires the client to choose it; VCFA 9.x
   * assigns one, so the vcfa path never sends it.
   */
  private subscriptionBody(params: {
    name?: string;
    eventTopicId?: string;
    runnableType?: string;
    runnableId?: string;
    projectId?: string;
    description?: string;
    blocking?: boolean;
    priority?: number;
    timeout?: number;
    disabled?: boolean;
    constraints?: Record<string, unknown>;
  }): Record<string, unknown> {
    const body: Record<string, unknown> = { type: "RUNNABLE" };
    if (params.name !== undefined) body.name = params.name;
    if (params.eventTopicId !== undefined)
      body.eventTopicId = params.eventTopicId;
    if (params.runnableType !== undefined)
      body.runnableType = params.runnableType;
    if (params.runnableId !== undefined) body.runnableId = params.runnableId;
    if (params.projectId !== undefined) body.projectId = params.projectId;
    if (params.description !== undefined) body.description = params.description;
    if (params.blocking !== undefined) body.blocking = params.blocking;
    if (params.priority !== undefined) body.priority = params.priority;
    if (params.timeout !== undefined) body.timeout = params.timeout;
    if (params.disabled !== undefined) body.disabled = params.disabled;
    if (params.constraints !== undefined) body.constraints = params.constraints;
    return body;
  }

  /**
   * Create a subscription.
   *
   * vRA 8 differs from VCFA 9.x on this endpoint in two ways, both verified
   * against a vRA 8.18 lab under VCFO-070: the client must choose the id (a
   * body without one answers 500 "The given id must not be null"), and the
   * 201 carries an empty body with the created resource in the Location
   * header. So the vra8 path generates a UUID and re-reads the element, which
   * is what callers expect back — without the re-read the tool would render
   * the empty {} that request() returns for a bodyless response.
   */
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
    const body = this.subscriptionBody(params);
    if (this.http.targetPlatform !== "vra8") {
      return this.http.post<Subscription>(
        "/subscriptions",
        body,
        this.http.eventBrokerBaseUrl,
      );
    }
    const id = randomUUID();
    body.id = id;
    await this.http.post<unknown>(
      "/subscriptions",
      body,
      this.http.eventBrokerBaseUrl,
    );
    return this.getSubscription(id);
  }

  /**
   * Update a subscription.
   *
   * vRA 8 does not serve PUT or PATCH on this path — both answer 405 — so the
   * update is the same POST, upserted under the existing id (verified on vRA
   * 8.18, VCFO-070). That POST validates the whole body, so the current
   * element is read first and the caller's changes merged onto it; only the
   * caller-settable fields are carried forward, never server-owned ones such
   * as orgId, ownerId, subscriberId, system, or contextual.
   *
   * Unlike the configuration-element PUT that VCFO-068 had to guard, a partial
   * body here cannot silently discard fields: vRA 8 rejects one outright with
   * 400 "Property: eventTopicId must not be blank" before mutating anything.
   *
   * One carry-forward is unverified against the wire: the lab had no
   * subscription with `constraints` set, so that field is preserved on the
   * data-preserving assumption rather than on an observation. Omitting it
   * would clear an existing constraint set, which is the worse failure.
   */
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
    },
  ): Promise<Subscription> {
    if (this.http.targetPlatform !== "vra8") {
      return this.http.put<Subscription>(
        `/subscriptions/${encodeURIComponent(id)}`,
        params,
        this.http.eventBrokerBaseUrl,
      );
    }
    const current = await this.getSubscription(id);
    const body = this.subscriptionBody({
      name: params.name ?? current.name,
      eventTopicId: current.eventTopicId,
      runnableType: params.runnableType ?? current.runnableType,
      runnableId: params.runnableId ?? current.runnableId,
      projectId: current.projectId,
      description: params.description ?? current.description,
      blocking: params.blocking ?? current.blocking,
      priority: params.priority ?? current.priority,
      timeout: params.timeout ?? current.timeout,
      disabled: params.disabled ?? current.disabled,
      constraints: params.constraints ?? current.constraints,
    });
    body.id = id;
    await this.http.post<unknown>(
      "/subscriptions",
      body,
      this.http.eventBrokerBaseUrl,
    );
    return this.getSubscription(id);
  }

  async deleteSubscription(id: string): Promise<void> {
    await this.http.del<unknown>(
      `/subscriptions/${encodeURIComponent(id)}`,
      this.http.eventBrokerBaseUrl,
    );
  }

  listEventTopics(options?: ListOptions): Promise<EventTopicList> {
    return getAllAutomationPages(
      this.http,
      "/topics",
      this.http.eventBrokerBaseUrl,
      undefined,
      { maxItems: options?.limit },
    );
  }
}
