import type {
  CatalogItem,
  CatalogItemList,
  CatalogItemRequestResponse,
  ListOptions,
} from "../types.js";
import type { VroHttpClient } from "./core.js";
import { matchesNameOrDescription } from "./filter.js";
import { getFilteredAutomationList } from "./pagination.js";

export class CatalogClient {
  constructor(private http: VroHttpClient) {}

  listCatalogItems(search?: string, options?: ListOptions): Promise<CatalogItemList> {
    const params = new URLSearchParams();
    // Trimmed so the server-side query and the client-side needle agree on
    // what counts as a filter: a blank one is neither sent nor matched, and a
    // padded one selects the same rows on both. See getFilteredAutomationList.
    const trimmedSearch = search?.trim();
    if (trimmedSearch) {
      params.set("$search", trimmedSearch);
    }
    return getFilteredAutomationList<CatalogItem>(
      this.http,
      "/items",
      this.http.catalogBaseUrl,
      params,
      matchesNameOrDescription,
      trimmedSearch,
      options?.limit,
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
  }): Promise<CatalogItemRequestResponse> {
    const body: Record<string, unknown> = {
      deploymentName: params.deploymentName,
      projectId: params.projectId,
    };
    if (params.version !== undefined) body.version = params.version;
    if (params.reason !== undefined) body.reason = params.reason;
    if (params.inputs !== undefined) body.inputs = params.inputs;
    return this.http.post<CatalogItemRequestResponse>(
      `/items/${encodeURIComponent(params.catalogItemId)}/request`,
      body,
      this.http.catalogBaseUrl,
    );
  }
}
