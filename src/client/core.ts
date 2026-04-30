import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { VroClientConfig } from "../types.js";

/**
 * Shared HTTP/authentication layer for VCF Automation and vRO APIs.
 * Uses native fetch() (Node 18+).
 */
export class VroHttpClient {
  readonly baseUrl: string;
  readonly eventBrokerBaseUrl: string;
  readonly catalogBaseUrl: string;
  readonly deploymentBaseUrl: string;
  readonly blueprintBaseUrl: string;
  readonly packageDir: string;
  readonly resourceDir: string;
  readonly workflowDir: string;
  readonly actionDir: string;
  readonly configurationDir: string;

  private sessionUrl: string;
  private loginHeader: string;
  private token: string | null = null;

  constructor(config: VroClientConfig) {
    if (config.ignoreTls) {
      process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
    }
    this.baseUrl = `https://${config.host}/vco/api`;
    this.eventBrokerBaseUrl = `https://${config.host}/event-broker/api`;
    this.catalogBaseUrl = `https://${config.host}/catalog/api`;
    this.deploymentBaseUrl = `https://${config.host}/deployment/api`;
    this.blueprintBaseUrl = `https://${config.host}/blueprint/api`;
    this.sessionUrl = `https://${config.host}/cloudapi/1.0.0/sessions`;
    this.packageDir = resolve(
      config.packageDir ?? join(tmpdir(), "mcp-vcf-orchestrator", "packages"),
    );
    this.resourceDir = resolve(
      config.resourceDir ?? join(tmpdir(), "mcp-vcf-orchestrator", "resources"),
    );
    this.workflowDir = resolve(
      config.workflowDir ?? join(tmpdir(), "mcp-vcf-orchestrator", "workflows"),
    );
    this.actionDir = resolve(
      config.actionDir ?? join(tmpdir(), "mcp-vcf-orchestrator", "actions"),
    );
    this.configurationDir = resolve(
      config.configurationDir ??
        join(tmpdir(), "mcp-vcf-orchestrator", "configurations"),
    );
    this.loginHeader =
      "Basic " +
      Buffer.from(
        `${config.username}@${config.organization}:${config.password}`,
      ).toString("base64");
  }

  async ensureAuthenticated(): Promise<string> {
    if (!this.token) {
      await this.authenticate();
    }
    if (!this.token) {
      throw new Error("Authentication did not produce a bearer token");
    }
    return this.token;
  }

  private async authenticate(): Promise<void> {
    console.error("[vro-client] Authenticating via VCF Cloud API sessions…");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    let res: Response;
    try {
      res = await fetch(this.sessionUrl, {
        method: "POST",
        headers: {
          Authorization: this.loginHeader,
          "Content-Type": "application/json;version=9.0.0",
          Accept: "application/json;version=9.0.0",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `VCF authentication failed: ${res.status} ${res.statusText}\n${text}`,
      );
    }

    const token = res.headers.get("x-vmware-vcloud-access-token");
    if (!token) {
      throw new Error(
        "VCF authentication succeeded but x-vmware-vcloud-access-token header was missing",
      );
    }

    this.token = token;
    console.error("[vro-client] Authentication successful, token acquired.");
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    overrideBaseUrl?: string,
  ): Promise<T> {
    const token = await this.ensureAuthenticated();
    const url = `${overrideBaseUrl ?? this.baseUrl}${path}`;
    console.error(`[vro-client] ${method} ${path}`);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vRO API error: ${res.status} ${res.statusText} — ${method} ${path}\n${text}`,
      );
    }

    const text = await res.text();
    if (!text) {
      const location = res.headers.get("location");
      if (location) {
        const id = location.split("/").pop() ?? "";
        return { id, state: "running" } as T;
      }
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  get<T>(path: string, overrideBaseUrl?: string): Promise<T> {
    return this.request<T>("GET", path, undefined, overrideBaseUrl);
  }

  post<T>(path: string, body?: unknown, overrideBaseUrl?: string): Promise<T> {
    return this.request<T>("POST", path, body, overrideBaseUrl);
  }

  put<T>(path: string, body?: unknown, overrideBaseUrl?: string): Promise<T> {
    return this.request<T>("PUT", path, body, overrideBaseUrl);
  }

  del<T>(path: string, overrideBaseUrl?: string): Promise<T> {
    return this.request<T>("DELETE", path, undefined, overrideBaseUrl);
  }
}
