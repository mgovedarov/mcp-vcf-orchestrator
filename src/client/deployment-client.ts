import type {
  Deployment,
  DeploymentActionList,
  DeploymentActionRequestParams,
  DeploymentList,
  DeploymentRequest,
} from "../types.js";
import type { VroHttpClient } from "./core.js";
import { getAllAutomationPages } from "./pagination.js";

export class DeploymentClient {
  constructor(private http: VroHttpClient) {}

  listDeployments(
    search?: string,
    projectId?: string,
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
    );
  }

  getDeployment(id: string): Promise<Deployment> {
    return this.http.get<Deployment>(
      `/deployments/${encodeURIComponent(id)}`,
      this.http.deploymentBaseUrl,
    );
  }

  async deleteDeployment(id: string): Promise<void> {
    await this.http.del<unknown>(
      `/deployments/${encodeURIComponent(id)}`,
      this.http.deploymentBaseUrl,
    );
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
