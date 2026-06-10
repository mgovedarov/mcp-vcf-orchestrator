import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Agent } from "undici";
import type { VroClientConfig, VroTargetPlatform } from "../types.js";

const UNSUPPORTED_AUTOMATION_SERVICES =
  "Automation-service APIs (catalog, deployments, templates, subscriptions, and event topics) are not supported in VCFA_TARGET_PLATFORM=vra8 Basic-auth mode. This mode supports vRO /vco/api read operations plus workflow execution and execution logs.";

const UNSUPPORTED_VRO_WRITE =
  "This vRO operation is not supported in VCFA_TARGET_PLATFORM=vra8 mode. The vRA/vRO 8 compatibility phase supports read operations plus workflow execution and execution logs only.";

// The default TypeScript lib's RequestInit lacks undici's dispatcher option,
// which Node's built-in fetch honors at runtime.
type DispatchedRequestInit = RequestInit & { dispatcher?: Agent };

const SAFE_ERROR_BODY_KEYS = new Set(["message", "statusCode", "code", "error", "errors"]);
const NON_JSON_BODY_LIMIT = 200;
const ERRORS_ARRAY_LIMIT = 5;

/**
 * Sanitize a raw HTTP response body before including it in a thrown error.
 * Extracts only known-safe diagnostic fields from JSON bodies; truncates
 * non-JSON bodies. Never surfaces unbounded raw response content.
 * Optionally prepends a correlation ID header when res is provided.
 */
export function sanitizeErrorBody(rawText: string, res?: Response): string {
  const parts: string[] = [];

  if (res) {
    for (const header of ["x-request-id", "x-correlation-id", "x-vcf-requestid"]) {
      const val = res.headers.get(header);
      if (val) {
        parts.push(`${header}: ${val}`);
        break;
      }
    }
  }

  if (!rawText) return parts.join("\n");

  try {
    const parsed: unknown = JSON.parse(rawText);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const safe: Record<string, unknown> = {};
      for (const key of SAFE_ERROR_BODY_KEYS) {
        if (!(key in obj)) continue;
        const val = obj[key];
        if (key === "errors" && Array.isArray(val)) {
          safe.errors = val.slice(0, ERRORS_ARRAY_LIMIT).map((e: unknown) => {
            if (typeof e === "string") return e;
            if (typeof e === "object" && e !== null) {
              const msg = (e as Record<string, unknown>).message;
              if (typeof msg === "string") return msg;
            }
            return "[error]";
          });
        } else if (typeof val === "string" || typeof val === "number") {
          safe[key] = val;
        }
      }
      if (Object.keys(safe).length > 0) {
        parts.push(JSON.stringify(safe));
        return parts.join("\n");
      }
      parts.push("[no diagnostic fields in response]");
      return parts.join("\n");
    }
  } catch {
    // not valid JSON
  }

  // Non-JSON: truncate to limit exposure
  const excerpt = rawText.length <= NON_JSON_BODY_LIMIT
    ? rawText
    : `${rawText.slice(0, NON_JSON_BODY_LIMIT)}…`;
  parts.push(`[non-JSON body: ${excerpt}]`);
  return parts.join("\n");
}

export function normalizeTargetPlatform(
  value: VroClientConfig["targetPlatform"] | string | undefined,
): VroTargetPlatform {
  const normalized = value?.toLowerCase();
  if (normalized === undefined || normalized === "" || normalized === "vcfa") {
    return "vcfa";
  }
  if (normalized === "vra8") {
    return "vra8";
  }
  throw new Error("targetPlatform must be one of: vcfa, vra8.");
}

/**
 * Shared HTTP/authentication layer for VCF Automation and vRO APIs.
 * Uses native fetch() (Node 18+).
 */
export class VroHttpClient {
  readonly targetPlatform: VroTargetPlatform;
  readonly baseUrl: string;
  readonly eventBrokerBaseUrl: string;
  readonly catalogBaseUrl: string;
  readonly deploymentBaseUrl: string;
  readonly blueprintBaseUrl: string;
  readonly packageDir: string;
  readonly projectPackageName?: string;
  readonly projectPackageDescription?: string;
  readonly resourceDir: string;
  readonly workflowDir: string;
  readonly executionLogDir: string;
  readonly actionDir: string;
  readonly configurationDir: string;
  readonly contextDir: string;

  private sessionUrl: string;
  private loginHeader: string;
  private token: string | null = null;
  // Per-client dispatcher so ignoreTls relaxes TLS verification only for
  // this client's requests, never process-wide (no NODE_TLS_REJECT_UNAUTHORIZED).
  private readonly dispatcher: Agent | undefined;
  private dispatcherClosed = false;

  constructor(config: VroClientConfig) {
    this.targetPlatform = normalizeTargetPlatform(config.targetPlatform);
    this.dispatcher = config.ignoreTls
      ? new Agent({ connect: { rejectUnauthorized: false } })
      : undefined;
    this.baseUrl = `https://${config.host}/vco/api`;
    this.eventBrokerBaseUrl = `https://${config.host}/event-broker/api`;
    this.catalogBaseUrl = `https://${config.host}/catalog/api`;
    this.deploymentBaseUrl = `https://${config.host}/deployment/api`;
    this.blueprintBaseUrl = `https://${config.host}/blueprint/api`;
    this.sessionUrl = `https://${config.host}/cloudapi/1.0.0/sessions`;
    const artifactDir = resolve(
      config.artifactDir ?? join(tmpdir(), "mcp-vcf-orchestrator"),
    );
    this.packageDir = resolve(
      config.packageDir ?? join(artifactDir, "packages"),
    );
    this.projectPackageName = config.projectPackageName;
    this.projectPackageDescription = config.projectPackageDescription;
    this.resourceDir = resolve(
      config.resourceDir ?? join(artifactDir, "resources"),
    );
    this.workflowDir = resolve(
      config.workflowDir ?? join(artifactDir, "workflows"),
    );
    this.executionLogDir = resolve(
      config.executionLogDir ?? join(artifactDir, "execution-logs"),
    );
    this.actionDir = resolve(config.actionDir ?? join(artifactDir, "actions"));
    this.configurationDir = resolve(
      config.configurationDir ?? join(artifactDir, "configurations"),
    );
    this.contextDir = resolve(config.contextDir ?? join(artifactDir, "context"));
    this.loginHeader =
      "Basic " +
      Buffer.from(
        `${config.username}@${config.organization}:${config.password}`,
      ).toString("base64");
  }

  /**
   * Release the client's network resources. Closes the TLS-relaxed
   * dispatcher (if `ignoreTls` was configured) so its keep-alive sockets
   * do not linger until process exit. Safe to call multiple times.
   */
  async close(): Promise<void> {
    if (this.dispatcher && !this.dispatcherClosed) {
      this.dispatcherClosed = true;
      await this.dispatcher.close();
    }
  }

  async ensureAuthenticated(): Promise<string> {
    if (this.targetPlatform === "vra8") {
      return this.loginHeader;
    }
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
      const init: DispatchedRequestInit = {
        method: "POST",
        headers: {
          Authorization: this.loginHeader,
          "Content-Type": "application/json;version=9.0.0",
          Accept: "application/json;version=9.0.0",
        },
        signal: controller.signal,
        dispatcher: this.dispatcher,
      };
      res = await fetch(this.sessionUrl, init);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `VCF authentication failed: ${res.status} ${res.statusText}\n${sanitizeErrorBody(text, res)}`,
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

  async authorizationHeader(): Promise<string> {
    if (this.targetPlatform === "vra8") {
      return this.loginHeader;
    }
    return `Bearer ${await this.ensureAuthenticated()}`;
  }

  /**
   * Perform an authenticated fetch with automatic token refresh on 401/403.
   * On the default `vcfa` platform, if the response status is 401 or 403 the
   * cached bearer token is cleared, a fresh token is obtained, and the request
   * is retried exactly once.  The `vra8` Basic-auth platform never retries
   * because a 401 means the credentials are wrong.
   *
   * Callers receive the raw `Response` and are responsible for checking
   * `res.ok` and reading the body.
   */
  async authenticatedFetch(
    url: string,
    init: RequestInit & { headers: Record<string, string> },
    options?: { timeout?: number },
  ): Promise<Response> {
    const timeout = options?.timeout ?? 30_000;
    const authorization = await this.authorizationHeader();
    init.headers["Authorization"] = authorization;

    const doFetch = async (): Promise<Response> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      try {
        const fetchInit: DispatchedRequestInit = {
          ...init,
          signal: controller.signal,
          dispatcher: this.dispatcher,
        };
        return await fetch(url, fetchInit);
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const res = await doFetch();

    if (
      (res.status === 401 || res.status === 403) &&
      this.targetPlatform !== "vra8"
    ) {
      // Drain the rejected response body to release the socket promptly.
      res.body?.cancel().catch(() => {});
      console.error(
        "[vro-client] Received %d, clearing cached token and re-authenticating…",
        res.status,
      );
      this.token = null;
      await this.authenticate();
      init.headers["Authorization"] = await this.authorizationHeader();
      return doFetch();
    }

    return res;
  }

  assertOperationSupported(
    method: string,
    path: string,
    overrideBaseUrl?: string,
  ): void {
    if (this.targetPlatform !== "vra8") return;

    if (overrideBaseUrl && overrideBaseUrl !== this.baseUrl) {
      throw new Error(UNSUPPORTED_AUTOMATION_SERVICES);
    }

    const normalizedMethod = method.toUpperCase();
    if (normalizedMethod === "GET") return;
    if (
      normalizedMethod === "POST" &&
      /^\/workflows\/[^/]+\/executions(?:$|\?)/.test(path)
    ) {
      return;
    }

    throw new Error(UNSUPPORTED_VRO_WRITE);
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    overrideBaseUrl?: string,
  ): Promise<T> {
    this.assertOperationSupported(method, path, overrideBaseUrl);
    const url = `${overrideBaseUrl ?? this.baseUrl}${path}`;
    console.error(`[vro-client] ${method} ${path}`);

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const res = await this.authenticatedFetch(
      url,
      {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `vRO API error: ${res.status} ${res.statusText} — ${method} ${path}\n${sanitizeErrorBody(text, res)}`,
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
