import type { CatalogItem, CatalogItemList, Deployment } from "../types.js";
import type { VroHttpClient } from "./core.js";

export class CatalogClient {
  constructor(private http: VroHttpClient) {}

  listCatalogItems(search?: string): Promise<CatalogItemList> {
    let path = "/items";
    if (search) {
      path += `?$search=${encodeURIComponent(search)}`;
    }
    return this.http.get<CatalogItemList>(path, this.http.catalogBaseUrl);
  }

  getCatalogItem(id: string): Promise<CatalogItem> {
    return this.http.get<CatalogItem>(
      `/items/${encodeURIComponent(id)}`,
      this.http.catalogBaseUrl
    );
  }

  createDeploymentFromCatalogItem(params: {
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
    return this.http.post<Deployment>(
      `/items/${encodeURIComponent(params.catalogItemId)}/request`,
      body,
      this.http.catalogBaseUrl
    );
  }
}
