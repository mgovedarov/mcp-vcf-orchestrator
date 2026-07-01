import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Agent, fetch as undiciFetch, FormData as UndiciFormData } from "undici";
import type {
  VroClientConfig,
  VroTargetPlatform,
  VroTargetPlatformInput,
} from "../types.js";

const UNSUPPORTED_AUTOMATION_SERVICES =
  "Automation-service APIs (catalog, deployments, templates, subscriptions, and event topics) are not supported in VCFA_TARGET_PLATFORM=vra8 Basic-auth mode. This mode supports vRO /vco/api read operations plus workflow execution and execution logs.";

const UNSUPPORTED_VRO_WRITE =
  "This vRO operation is not supported in VCFA_TARGET_PLATFORM=vra8 mode. The vRA/vRO 8 compatibility phase supports read operations plus workflow execution and execution logs only.";

// The default TypeScript lib's RequestInit lacks undici's dispatcher option.
// A dispatcher must be paired with undici's own fetch(): Node's global fetch
// is backed by the undici version bundled with the Node runtime, which can
// diverge in major version from the npm `undici` dependency, and dispatcher
// instances are not interchangeable across major versions.
type DispatchedRequestInit = RequestInit & { dispatcher?: Agent };

// Captured at module load, before any test replaces globalThis.fetch.
const nativeFetch = globalThis.fetch;

// Select the fetch implementation for a request. A dispatcher (Agent) must be
// paired with the undici it came from, so requests carrying one use undici's
// own fetch; everything else uses Node's global fetch.
//
// The pairing guarantee is conditional: if globalThis.fetch has been swapped
// since module load — a unit-test stub, or runtime instrumentation such as an
// APM agent that wraps fetch — we defer to the replacement so mocking keeps
// working. Note that an instrumentation wrapper combined with a dispatcher
// would reintroduce the cross-major mismatch this indirection exists to avoid.
function requestFetch(init: DispatchedRequestInit): typeof fetch {
  if (globalThis.fetch !== nativeFetch) return globalThis.fetch;
  return (init.dispatcher ? undiciFetch : nativeFetch) as typeof fetch;
}

// Build a multipart upload body. Uses undici's FormData deliberately: when a
// TLS-relaxed dispatcher is configured, uploads route through undici's own
// fetch (see requestFetch), and undici's fetch only serializes a FormData
// created by the same undici — a global (Node-bundled) FormData fails undici's
// internal brand check and is stringified to "[object FormData]" and sent as
// text/plain. undici's FormData also serializes correctly through Node's global
// fetch, so it is safe on both the strict-TLS and ignoreTls paths. The Blob may
// stay global; undici accepts node:buffer's Blob.
//
// The return is cast to the DOM FormData type: undici's FormData is runtime-
// compatible with a fetch body but nominally distinct from lib.dom's, and
// callers pass the result straight into fetch's RequestInit.body.
export function createUploadForm(buffer: Buffer, fileName: string): FormData {
  const form = new UndiciFormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), fileName);
  return form as unknown as FormData;
}

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

// Known VCF Cloud API versions this client can speak, newest first. Version
// negotiation picks the first entry the target server advertises via the
// unauthenticated GET /api/versions discovery document.
const VCFA_KNOWN_API_VERSIONS = ["9.1.0", "9.0.0"] as const;
// Used when discovery fails or advertises no known version. 9.0.0 is the most
// compatible choice: 9.1 servers still accept it, while 9.0 servers reject
// 9.1.0 outright.
const VCFA_FALLBACK_API_VERSION = "9.0.0";

export function normalizeTargetPlatform(
  value: VroClientConfig["targetPlatform"] | string | undefined,
): VroTargetPlatform {
  const normalized = value?.toLowerCase();
  if (
    normalized === undefined ||
    normalized === "" ||
    normalized === "vcfa" ||
    normalized === "vcfa9.0" ||
    normalized === "vcfa9.1"
  ) {
    return "vcfa";
  }
  if (normalized === "vra8") {
    return "vra8";
  }
  throw new Error(
    "targetPlatform must be one of: vcfa, vcfa9.0, vcfa9.1, vra8.",
  );
}

/**
 * Resolve an explicit VCF Cloud API version pin from the target platform
 * value. `vcfa9.0`/`vcfa9.1` pin the session API version and skip the
 * GET /api/versions discovery probe; plain `vcfa` (and `vra8`) return
 * undefined, meaning auto-negotiation.
 */
export function resolvePinnedApiVersion(
  value: VroClientConfig["targetPlatform"] | string | undefined,
): string | undefined {
  const normalized = value?.toLowerCase();
  if (normalized === "vcfa9.0") return "9.0.0";
  if (normalized === "vcfa9.1") return "9.1.0";
  return undefined;
}

/**
 * Validate a targetPlatform configuration value and return it in canonical
 * lowercase input form, preserving the `vcfa9.0`/`vcfa9.1` pins that
 * normalizeTargetPlatform collapses into the `vcfa` platform.
 */
export function normalizeTargetPlatformInput(
  value: VroClientConfig["targetPlatform"] | string | undefined,
): VroTargetPlatformInput {
  const platform = normalizeTargetPlatform(value);
  const normalized = value?.toLowerCase();
  if (normalized === "vcfa9.0" || normalized === "vcfa9.1") {
    return normalized;
  }
  return platform;
}

/**
 * Shared HTTP/authentication layer for VCF Automation and vRO APIs.
 * Uses fetch() (Node 22+); see requestFetch for the native/undici pairing.
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
  private versionsUrl: string;
  private isProviderLogin: boolean;
  private pinnedApiVersion: string | undefined;
  private negotiatedApiVersion: string | null = null;
  private loginHeader: string;
  private token: string | null = null;
  // Shared in-flight authentication so concurrent requests on a fresh or
  // expired session run one version probe and one session POST, not one each.
  private authInFlight: Promise<void> | null = null;
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
    // Provider/system administrators authenticate at the dedicated provider
    // session endpoint; the tenant endpoint rejects them with 401.
    this.isProviderLogin =
      config.organization.trim().toLowerCase() === "system";
    this.sessionUrl = this.isProviderLogin
      ? `https://${config.host}/cloudapi/1.0.0/sessions/provider`
      : `https://${config.host}/cloudapi/1.0.0/sessions`;
    this.versionsUrl = `https://${config.host}/api/versions`;
    this.pinnedApiVersion = resolvePinnedApiVersion(config.targetPlatform);
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
      await this.startAuthentication();
    }
    if (!this.token) {
      throw new Error("Authentication did not produce a bearer token");
    }
    return this.token;
  }

  private startAuthentication(): Promise<void> {
    if (!this.authInFlight) {
      this.authInFlight = this.authenticate().finally(() => {
        this.authInFlight = null;
      });
    }
    return this.authInFlight;
  }

  /**
   * Determine the VCF Cloud API version to use for the session request.
   * An explicit `vcfa9.0`/`vcfa9.1` pin wins; otherwise the unauthenticated
   * GET /api/versions discovery document is probed and the newest mutually
   * supported version is cached. A probe that completes but advertises no
   * known version caches the 9.0.0 fallback; a probe that fails outright
   * (network error, non-2xx, timeout) falls back to 9.0.0 for this attempt
   * only, so the next authentication retries discovery.
   */
  private async negotiateApiVersion(): Promise<string> {
    if (this.pinnedApiVersion) return this.pinnedApiVersion;
    if (this.negotiatedApiVersion) return this.negotiatedApiVersion;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    try {
      const init: DispatchedRequestInit = {
        method: "GET",
        headers: { Accept: "*/*" },
        signal: controller.signal,
        dispatcher: this.dispatcher,
      };
      const res = await requestFetch(init)(this.versionsUrl, init);
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      const advertised = new Set(
        [...text.matchAll(/<Version>(\d+\.\d+\.\d+)<\/Version>/g)].map(
          (m) => m[1],
        ),
      );
      const chosen = VCFA_KNOWN_API_VERSIONS.find((v) => advertised.has(v));
      if (chosen) {
        console.error(
          `[vro-client] Negotiated VCF Cloud API version ${chosen} via GET /api/versions`,
        );
        this.negotiatedApiVersion = chosen;
      } else {
        console.error(
          `[vro-client] WARNING: GET /api/versions advertised no known API version (known: ${VCFA_KNOWN_API_VERSIONS.join(", ")}); falling back to ${VCFA_FALLBACK_API_VERSION}`,
        );
        this.negotiatedApiVersion = VCFA_FALLBACK_API_VERSION;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[vro-client] WARNING: VCF Cloud API version discovery failed (${reason}); falling back to ${VCFA_FALLBACK_API_VERSION} for this attempt. Discovery is retried on the next authentication; set VCFA_TARGET_PLATFORM=vcfa9.1 or vcfa9.0 to pin the version explicitly.`,
      );
      return VCFA_FALLBACK_API_VERSION;
    } finally {
      clearTimeout(timeoutId);
    }
    return this.negotiatedApiVersion;
  }

  private async authenticate(): Promise<void> {
    const apiVersion = await this.negotiateApiVersion();
    console.error(
      `[vro-client] Authenticating via VCF Cloud API ${this.isProviderLogin ? "provider " : ""}sessions (version ${apiVersion})…`,
    );
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    let res: Response;
    try {
      const init: DispatchedRequestInit = {
        method: "POST",
        headers: {
          Authorization: this.loginHeader,
          "Content-Type": `application/json;version=${apiVersion}`,
          Accept: `application/json;version=${apiVersion}`,
        },
        signal: controller.signal,
        dispatcher: this.dispatcher,
      };
      res = await requestFetch(init)(this.sessionUrl, init);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const hint =
        res.status === 401
          ? this.isProviderLogin
            ? "\nHint: provider logins use the system organization — verify the username is a provider/system administrator account and the password is correct."
            : '\nHint: VCFA_ORGANIZATION must be the organization name (the tenant URL slug), not its display name. Provider/system administrators must set VCFA_ORGANIZATION=system, which routes the login to /cloudapi/1.0.0/sessions/provider.'
          : "";
      throw new Error(
        `VCF authentication failed: ${res.status} ${res.statusText}\n${sanitizeErrorBody(text, res)}${hint}`,
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
        return await requestFetch(fetchInit)(url, fetchInit);
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
      await this.startAuthentication();
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

  private async send(
    method: string,
    path: string,
    body?: unknown,
    overrideBaseUrl?: string,
  ): Promise<{ res: Response; text: string }> {
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

    return { res, text: await res.text() };
  }

  private parseJsonBody<T>(
    text: string,
    res: Response,
    method: string,
    path: string,
  ): T {
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        `vRO API error: non-JSON response body (${res.status} ${res.statusText}) — ${method} ${path}\n${sanitizeErrorBody(text, res)}`,
      );
    }
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    overrideBaseUrl?: string,
  ): Promise<T> {
    const { res, text } = await this.send(method, path, body, overrideBaseUrl);
    if (!text) return {} as T;
    return this.parseJsonBody<T>(text, res, method, path);
  }

  /**
   * POST an execution-style request where the API may answer 202 with an
   * empty body and a Location header pointing at the created execution.
   * Synthesizes { id, state: "running" } from the Location header in that
   * case; generic empty 2xx responses elsewhere must use request/post and
   * receive {} instead.
   */
  async startExecution<T>(path: string, body?: unknown): Promise<T> {
    const { res, text } = await this.send("POST", path, body);
    if (!text) {
      const location = res.headers.get("location");
      if (location) {
        const id = location.split("/").pop() ?? "";
        return { id, state: "running" } as T;
      }
      return {} as T;
    }
    return this.parseJsonBody<T>(text, res, "POST", path);
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
