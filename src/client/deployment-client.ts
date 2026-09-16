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
   * An empty 2xx body yields `undefined`.
   */
  async deleteDeployment(id: string): Promise<DeploymentRequest | undefined> {
    const result = await this.http.del<DeploymentRequest | Record<string, never>>(
      `/deployments/${encodeURIComponent(id)}`,
      this.http.deploymentBaseUrl,
    );
    return result && typeof result === "object" && Object.keys(result).length > 0
      ? (result as DeploymentRequest)
      : undefined;
  }

  listDeploymentActions(deploymentId: string): Promise<DeploymentActionList> {
    return this.http.get<DeploymentActionList>(
      `/deployments/${encodeURIComponent(deploymentId)}/actions`,
      this.http.deploymentBaseUrl,
    );
  }

  runDeploymentAction(
    params: DeploymentActionRequestParams,
  ): Promise<DeploymentRequest> {
    const body: Record<string, unknown> = {
      actionId: params.actionId,
    };
    if (params.reason !== undefined) body.reason = params.reason;
    if (params.inputs !== undefined) body.inputs = params.inputs;

    return this.http.post<DeploymentRequest>(
      `/deployments/${encodeURIComponent(params.deploymentId)}/requests`,
      body,
      this.http.deploymentBaseUrl,
    );
  }
}
