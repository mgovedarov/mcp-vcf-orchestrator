import type {
  Deployment,
  DeploymentActionList,
  DeploymentActionRequestParams,
  DeploymentList,
  DeploymentRequest,
  ListOptions,
} from "../types.js";
import type { VroHttpClient } from "./core.js";
import { getAllAutomationPages } from "./pagination.js";

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
    if (search) {
      params.set("$search", search);
    }
    if (projectId) {
      params.set("projectId", projectId);
    }
    return getAllAutomationPages<Deployment>(
      this.http,
      "/deployments",
      this.http.deploymentBaseUrl,
      params,
      { maxItems: options?.limit },
    );
  }

  getDeployment(id: string): Promise<Deployment> {
    return this.http.get<Deployment>(
      `/deployments/${encodeURIComponent(id)}`,
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
