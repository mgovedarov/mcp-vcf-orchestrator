import type {
  EventTopicList,
  ListOptions,
  Subscription,
  SubscriptionList,
} from "../types.js";
import { randomUUID } from "node:crypto";

import type { VroHttpClient } from "./core.js";
import { getAllAutomationPages } from "./pagination.js";

/**
 * Fields the server owns on a subscription element, stripped before the vra8
 * update upserts the live element back. Everything else carries forward,
 * including fields `Subscription` does not model — see updateSubscription.
 */
const SERVER_OWNED_SUBSCRIPTION_FIELDS = [
  "orgId",
  "ownerId",
  "subscriberId",
  "system",
  "contextual",
  "selfLink",
] as const;

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
   * The create body, in the shape the API expects. `type: "RUNNABLE"` is an
   * anchor of this builder, not a general default: create-subscription only
   * ever creates a runnable subscription. The update path must not reuse it —
   * a live element carries its own `type` (vRA 8 also serves `SUBSCRIBABLE`
   * service subscribers), and rebuilding one from this shape would reclassify
   * it. The caller-chosen `id` vRA 8 requires is set by the caller, because
   * VCFA 9.x assigns one and its path never sends it.
   */
  private subscriptionBody(params: {
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
  }): Record<string, unknown> {
    const body: Record<string, unknown> = {
      type: "RUNNABLE",
      name: params.name,
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
   *
   * The POST resolving means the element exists, so a failing read-back must
   * not surface as a failed create: the caller would be told nothing was
   * created and would retry under a fresh UUID, leaving a second live
   * subscription nobody knows about. The posted body is returned instead.
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
    try {
      return await this.getSubscription(id);
    } catch {
      // Created, but not readable back yet. What was posted is what was stored.
      return body as unknown as Subscription;
    }
  }

  /**
   * Update a subscription.
   *
   * vRA 8 does not serve PUT or PATCH on this path — both answer 405 — so the
   * update is the same POST, upserted under the existing id (verified on vRA
   * 8.18, VCFO-070). That POST replaces the whole element, so the body starts
   * from the live one and strips only the fields the server owns; the caller's
   * changes are then laid over it.
   *
   * Starting from the live element rather than rebuilding an allow-listed one
   * is the point. The upsert replaces what it does not carry, and `Subscription`
   * models only the fields these tools read — vRA 8 serves others (`system` and
   * `contextual` among them). Rebuilding would clear every unmodeled field on
   * an update that never mentioned it, and nothing would report it: the
   * `400 Property: eventTopicId must not be blank` that rejects a partial body
   * only fires when `eventTopicId` is absent, and the merge always carries it,
   * so that validation is no protection against a merge gap. Carrying an
   * unknown field forward is the safe direction of that uncertainty — as it is
   * for `constraints`, which the lab had no subscription set to exercise.
   *
   * `current` lets a caller that already read the element (the expected-target
   * guard in update-subscription does) hand it in, so a guarded update reads
   * once and merges the same snapshot it verified.
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
    current?: Subscription,
  ): Promise<Subscription> {
    if (this.http.targetPlatform !== "vra8") {
      return this.http.put<Subscription>(
        `/subscriptions/${encodeURIComponent(id)}`,
        params,
        this.http.eventBrokerBaseUrl,
      );
    }
    const live = current ?? (await this.getSubscription(id));
    if (!live.eventTopicId) {
      throw new Error(
        `Subscription ${id} carries no eventTopicId, which vRA 8 requires on the POST upsert that serves as its update (it answers PUT and PATCH with 405). Nothing was mutated. Only subscriptions bound to an event topic can be updated in VCFA_TARGET_PLATFORM=vra8 mode.`,
      );
    }
    const body: Record<string, unknown> = { ...live };
    for (const field of SERVER_OWNED_SUBSCRIPTION_FIELDS) delete body[field];
    for (const [field, value] of Object.entries(params)) {
      if (value !== undefined) body[field] = value;
    }
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
