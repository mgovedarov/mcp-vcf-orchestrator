import type { Deployment, DeploymentList } from "../types.js";
import type { VroHttpClient } from "./core.js";

export class DeploymentClient {
  constructor(private http: VroHttpClient) {}

  listDeployments(search?: string, projectId?: string): Promise<DeploymentList> {
    const params: string[] = [];
    if (search) {
      params.push(`$search=${encodeURIComponent(search)}`);
    }
    if (projectId) {
      params.push(`projectId=${encodeURIComponent(projectId)}`);
    }
    const path = params.length > 0 ? `/deployments?${params.join("&")}` : "/deployments";
    return this.http.get<DeploymentList>(path, this.http.deploymentBaseUrl);
  }

  getDeployment(id: string): Promise<Deployment> {
    return this.http.get<Deployment>(
      `/deployments/${encodeURIComponent(id)}`,
      this.http.deploymentBaseUrl
    );
  }

  async deleteDeployment(id: string): Promise<void> {
    await this.http.del<unknown>(
      `/deployments/${encodeURIComponent(id)}`,
      this.http.deploymentBaseUrl
    );
  }
}
