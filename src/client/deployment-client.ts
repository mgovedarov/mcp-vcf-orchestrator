import type {
  Deployment,
  DeploymentActionList,
  DeploymentActionRequestParams,
  DeploymentList,
  DeploymentRequest,
  DeploymentRequestList,
  ListOptions,
} from "../types.js";
import type { VroHttpClient } from "./core.js";
import { matchesNameOrDescription } from "./filter.js";
import {
  getAllAutomationPages,
  getFilteredAutomationList,
} from "./pagination.js";

/**
 * Both deployment-service writes answer a `DeploymentRequest`. `request<T>`
 * turns an empty body into `{}`, which is kept as-is: the handlers guard every
 * field, and "no request came back" then reads the same way from both writes.
 * A bare array -- the shape the sibling catalog route serves on both platforms,
 * never observed on these two routes -- is unwrapped to its first element
 * rather than cast whole, so its fields would still render; any other
 * non-object body reads as no request (VCFO-088).
 */
function asDeploymentRequest(result: unknown): DeploymentRequest {
  const candidate = Array.isArray(result) ? result[0] : result;
  return candidate && typeof candidate === "object"
    ? (candidate as DeploymentRequest)
    : {};
}

export class DeploymentClient {
  constructor(private http: VroHttpClient) {}

  listDeployments(
    search?: string,
    projectId?: string,
    options?: ListOptions,
  ): Promise<DeploymentList> {
    const params = new URLSearchParams();
    // Trimmed so the server-side query and the client-side needle agree on
    // what counts as a filter: a blank one is neither sent nor matched, and a
    // padded one selects the same rows on both. See getFilteredAutomationList.
    const trimmedSearch = search?.trim();
    if (trimmedSearch) {
      params.set("$search", trimmedSearch);
    }
    if (projectId) {
      params.set("projectId", projectId);
    }
    return getFilteredAutomationList<Deployment>(
      this.http,
      "/deployments",
      this.http.deploymentBaseUrl,
      params,
      matchesNameOrDescription,
      trimmedSearch,
      options?.limit,
    );
  }

  getDeployment(id: string): Promise<Deployment> {
    return this.http.get<Deployment>(
      `/deployments/${encodeURIComponent(id)}`,
      this.http.deploymentBaseUrl,
    );
  }

  getDeploymentRequest(requestId: string): Promise<DeploymentRequest> {
    return this.http.get<DeploymentRequest>(
      `/requests/${encodeURIComponent(requestId)}`,
      this.http.deploymentBaseUrl,
    );
  }

  /**
   * `DELETE /deployments/{id}` does not delete synchronously: on vRA 8.18 it
   * answers 200 with the `Deployment.Delete` request it queued, `status:
   * PENDING`, and the deployment reads `DELETE_INPROGRESS` for a while before
   * it answers 404 (VCFO-088; the 9.1 round saw the same status sequence but
   * did not record the body). That request is handed back so the tool can say
   * deletion was *requested*, with the request id, rather than that it is done.
   */
  async deleteDeployment(id: string): Promise<DeploymentRequest> {
    return asDeploymentRequest(
      await this.http.del<unknown>(
        `/deployments/${encodeURIComponent(id)}`,
        this.http.deploymentBaseUrl,
      ),
    );
  }

  listDeploymentActions(deploymentId: string): Promise<DeploymentActionList> {
    return this.http.get<DeploymentActionList>(
      `/deployments/${encodeURIComponent(deploymentId)}/actions`,
      this.http.deploymentBaseUrl,
    );
  }

  /**
   * A deployment's request history: every create, day-2 and delete request
   * submitted against it, whoever submitted it and through whatever interface.
   * This is the only route that hands out a **create** request's id -- `POST
   * /catalog/api/items/{id}/request` answers `{deploymentId, deploymentName}`
   * and no request id at all -- so without it the request that provisioned a
   * deployment is readable by id and its id is undiscoverable (VCFO-097).
   *
   * The deployment-scoped route is sent rather than the equivalent `GET
   * /requests?deploymentId=<id>`: both serve the same page on both platforms
   * (VCFO-095), and this one mirrors the sibling `listDeploymentActions` above.
   * Switching arms later is a path change here, nothing more.
   *
   * Answers 404 once the deployment is gone, while each request it listed
   * still reads through `getDeploymentRequest`.
   */
  listDeploymentRequests(
    deploymentId: string,
    options?: ListOptions,
  ): Promise<DeploymentRequestList> {
    return getAllAutomationPages<DeploymentRequest>(
      this.http,
      `/deployments/${encodeURIComponent(deploymentId)}/requests`,
      this.http.deploymentBaseUrl,
      new URLSearchParams(),
      { maxItems: options?.limit },
    );
  }

  async runDeploymentAction(
    params: DeploymentActionRequestParams,
  ): Promise<DeploymentRequest> {
    const body: Record<string, unknown> = {
      actionId: params.actionId,
    };
    if (params.reason !== undefined) body.reason = params.reason;
    if (params.inputs !== undefined) body.inputs = params.inputs;

    return asDeploymentRequest(
      await this.http.post<unknown>(
        `/deployments/${encodeURIComponent(params.deploymentId)}/requests`,
        body,
        this.http.deploymentBaseUrl,
      ),
    );
  }
}
