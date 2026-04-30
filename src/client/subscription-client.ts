import type { EventTopicList, Subscription, SubscriptionList } from "../types.js";
import type { VroHttpClient } from "./core.js";

export class SubscriptionClient {
  constructor(private http: VroHttpClient) {}

  listSubscriptions(projectId?: string): Promise<SubscriptionList> {
    let path = "/subscriptions";
    if (projectId) {
      path += `?$filter=projectId eq '${encodeURIComponent(projectId)}'`;
    }
    return this.http.get<SubscriptionList>(path, this.http.eventBrokerBaseUrl);
  }

  getSubscription(id: string): Promise<Subscription> {
    return this.http.get<Subscription>(
      `/subscriptions/${encodeURIComponent(id)}`,
      this.http.eventBrokerBaseUrl
    );
  }

  createSubscription(params: {
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
    return this.http.post<Subscription>("/subscriptions", body, this.http.eventBrokerBaseUrl);
  }

  updateSubscription(
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
    return this.http.put<Subscription>(
      `/subscriptions/${encodeURIComponent(id)}`,
      params,
      this.http.eventBrokerBaseUrl
    );
  }

  async deleteSubscription(id: string): Promise<void> {
    await this.http.del<unknown>(
      `/subscriptions/${encodeURIComponent(id)}`,
      this.http.eventBrokerBaseUrl
    );
  }

  listEventTopics(): Promise<EventTopicList> {
    return this.http.get<EventTopicList>("/topics", this.http.eventBrokerBaseUrl);
  }
}
