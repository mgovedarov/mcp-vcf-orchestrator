import type { CatalogItem, CatalogItemList, Deployment } from "../types.js";
import type { VroHttpClient } from "./core.js";
import { getAllAutomationPages } from "./pagination.js";

export class CatalogClient {
  constructor(private http: VroHttpClient) {}

  listCatalogItems(search?: string): Promise<CatalogItemList> {
    const params = new URLSearchParams();
    if (search) {
      params.set("$search", search);
    }
    return getAllAutomationPages<CatalogItem>(
      this.http,
      "/items",
      this.http.catalogBaseUrl,
      params,
    );
  }

  getCatalogItem(id: string): Promise<CatalogItem> {
    return this.http.get<CatalogItem>(
      `/items/${encodeURIComponent(id)}`,
      this.http.catalogBaseUrl,
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
      this.http.catalogBaseUrl,
    );
  }
}
