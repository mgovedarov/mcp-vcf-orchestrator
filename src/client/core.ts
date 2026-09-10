import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Agent, fetch as undiciFetch, FormData as UndiciFormData } from "undici";
import type {
  VroClientConfig,
  VroTargetPlatform,
  VroTargetPlatformInput,
} from "../types.js";

const UNSUPPORTED_AUTOMATION_SERVICES =
  "Automation-service APIs (catalog, deployments, templates, projects, subscriptions, and event topics) are not supported in VCFA_TARGET_PLATFORM=vra8 mode. This mode supports vRO /vco/api read operations plus workflow execution and execution logs.";

const UNSUPPORTED_VRO_WRITE =
  "This vRO operation is not supported in VCFA_TARGET_PLATFORM=vra8 mode. The vRA/vRO 8 compatibility phase supports read operations plus workflow execution and execution logs only.";

// Appended to vRA 8 login failures. The CSP login answers wrong credentials
// and unknown domains with 400 (not 401), so the hint covers both.
const VRA8_LOGIN_HINT =
  '\nHint: in VCFA_TARGET_PLATFORM=vra8 mode, VCFA_USERNAME and VCFA_PASSWORD are the vIDM (Workspace ONE Access) credentials and VCFA_ORGANIZATION is the vIDM domain shown on the login page, for example "System Domain" for local users.';

// The default TypeScript lib's RequestInit lacks undici's dispatcher option.
type DispatchedRequestInit = RequestInit & { dispatcher?: Agent };

// Captured at module load, before any test replaces globalThis.fetch.
const nativeFetch = globalThis.fetch;

// Select the fetch implementation for a request. Production requests always use
// the npm `undici` package's own fetch(), never Node's global fetch, so that
// fetch(), the FormData it serializes (see createUploadForm), and the ignoreTls
// dispatcher Agent all come from the SAME undici. The undici bundled in the Node
// runtime is a different major (Node 22 -> undici 6, Node 24 -> undici 7) and is
// not interchangeable: its fetch rejects an npm-undici FormData — stringifying
// the body to "[object FormData]" and sending it as text/plain — and cannot
// honor an npm-undici dispatcher.
//
// The exception is a swapped globalThis.fetch — a unit-test stub, or runtime
// instrumentation such as an APM agent that wraps fetch, installed after module
// load: we defer to the replacement so mocking and instrumentation keep working.
// An instrumentation wrapper is assumed to delegate to a compatible fetch;
// combining one with an npm-undici dispatcher would reintroduce the cross-major
// mismatch this indirection exists to avoid.
function requestFetch(): typeof fetch {
  if (globalThis.fetch !== nativeFetch) return globalThis.fetch;
  // undici's fetch is runtime-compatible but its Response type is nominally
  // distinct from lib.dom's, so bridge through unknown.
  return undiciFetch as unknown as typeof fetch;
}

// Build a multipart upload body with undici's FormData. Uploads route through
// undici's own fetch (see requestFetch), and undici's fetch only serializes a
// FormData created by the same undici — a foreign FormData (e.g. the global one,
// backed by a different bundled-undici major) fails its internal brand check and
// is stringified to "[object FormData]" and sent as text/plain. The Blob may
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
 * Parse a response body as a JSON object. Returns undefined for a body that is
 * not valid JSON or whose top level is not a plain object (an array, a scalar,
 * or null), so both body helpers below agree on what counts as an object body.
 * Never throws.
 */
function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not valid JSON
  }
  return undefined;
}

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

  const obj = parseJsonObject(rawText);
  if (obj) {
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

  // Non-JSON: truncate to limit exposure
  const excerpt = rawText.length <= NON_JSON_BODY_LIMIT
    ? rawText
    : `${rawText.slice(0, NON_JSON_BODY_LIMIT)}…`;
  parts.push(`[non-JSON body: ${excerpt}]`);
  return parts.join("\n");
}

/**
 * Extract a non-empty string field from a JSON object body. Returns undefined
 * for non-JSON, non-object, missing, or non-string values and never throws, so
 * callers can fail without echoing a 2xx body that may carry token material.
 */
function readStringField(text: string, key: string): string | undefined {
  const value = parseJsonObject(text)?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * A login response with its body already read. `bodyError` records a body-read
 * failure (a truncated connection, a mid-body abort) so a login that never
 * yielded a readable body is reported as such instead of as a missing field.
 */
type LoginResponse = { res: Response; text: string; bodyError?: string };

async function readLoginResponse(res: Response): Promise<LoginResponse> {
  try {
    return { res, text: await res.text() };
  } catch (error) {
    return {
      res,
      text: "",
      bodyError: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Name the host a redirect points at, for a login-failure message. Returns
 * undefined for a relative Location; only the host is used, never the full URL,
 * which can carry token material in its query.
 */
function redirectHost(location: string): string | undefined {
  try {
    return new URL(location).host;
  } catch {
    return undefined;
  }
}

/**
 * Describe why a login response was unusable, in a form that is safe to
 * surface. A redirect names the host it points at; another non-2xx reports its
 * status plus the sanitized body; a 2xx that did not carry `expectedField`
 * reports the status, the declared content type, and the shape of the body
 * (unreadable, empty, non-JSON, or JSON without the field) but never the body
 * itself, because a login 2xx body can carry token material.
 */
function describeLoginFailure(
  result: LoginResponse,
  expectedField: string,
): string {
  const { res, text, bodyError } = result;
  // HTTP/2 carries no reason phrase, so statusText is frequently empty.
  const status = res.statusText ? `${res.status} ${res.statusText}` : `${res.status}`;

  if (bodyError) {
    return `${status} but the response body could not be read: ${bodyError}`;
  }

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    const host = location ? redirectHost(location) : undefined;
    return `${status}: the login endpoint answered with a redirect${host ? ` to ${host}` : ""}, which is not followed because the request body carries the credentials. Verify VCFA_HOST addresses the appliance's API endpoint directly, with no SSO or load-balancer redirect in front of it.`;
  }

  if (!res.ok) {
    return `${status}\n${sanitizeErrorBody(text, res)}`;
  }

  const contentType = res.headers.get("content-type") ?? "none";
  const shape = !text
    ? "an empty body"
    : parseJsonObject(text)
      ? `a JSON object that has no ${expectedField} string`
      : `a ${text.length}-byte body that is not a JSON object, which usually means an SSO or proxy page answered instead of the API`;
  return `${status} with ${shape} (content-type: ${contentType})`;
}

// Deadline for every request this client issues: the version probe, both
// login flows, and API calls that do not pass an explicit timeout.
const REQUEST_TIMEOUT_MS = 30_000;

// Known VCF Cloud API versions this client can speak, newest first. Version
// negotiation picks the first entry the target server advertises via the
// unauthenticated GET /api/versions discovery document.
const VCFA_KNOWN_API_VERSIONS = ["9.1.0", "9.0.0"] as const;
// Used when discovery fails or advertises no known version. 9.0.0 is the most
// compatible choice: 9.1 servers still accept it, while 9.0 servers reject
// 9.1.0 outright.
const VCFA_FALLBACK_API_VERSION = "9.0.0";

/**
 * Credential material and endpoint for the VCF Cloud API session POST. Built
 * only on the `vcfa` platform.
 */
type VcfaLogin = {
  kind: "vcfa";
  // Basic credentials for the session POST.
  header: string;
  sessionUrl: string;
  isProviderLogin: boolean;
};

/**
 * Credential material and endpoints for the vRA 8 login. Built only on the
 * `vra8` platform: vRA 8 rejects Basic auth on /vco/api, so the bearer token
 * comes from the vIDM CSP login (credentials -> refresh_token) followed by the
 * IaaS token exchange (refresh_token -> token).
 */
type Vra8Login = {
  kind: "vra8";
  cspLoginUrl: string;
  iaasLoginUrl: string;
  body: { username: string; password: string; domain: string };
};

function buildVcfaLogin(config: VroClientConfig): VcfaLogin {
  // Provider/system administrators authenticate at the dedicated provider
  // session endpoint; the tenant endpoint rejects them with 401.
  const isProviderLogin = config.organization.trim().toLowerCase() === "system";
  return {
    kind: "vcfa",
    header:
      "Basic " +
      Buffer.from(
        `${config.username}@${config.organization}:${config.password}`,
      ).toString("base64"),
    sessionUrl: isProviderLogin
      ? `https://${config.host}/cloudapi/1.0.0/sessions/provider`
      : `https://${config.host}/cloudapi/1.0.0/sessions`,
    isProviderLogin,
  };
}

function buildVra8Login(config: VroClientConfig): Vra8Login {
  return {
    kind: "vra8",
    // The bare `?access_token` query (no value) is required: without it the
    // CSP login answers with a UI session token instead of refresh_token.
    // Keep it a literal; URLSearchParams would emit `?access_token=`.
    cspLoginUrl: `https://${config.host}/csp/gateway/am/api/login?access_token`,
    iaasLoginUrl: `https://${config.host}/iaas/api/login`,
    body: {
      username: config.username,
      password: config.password,
      // vra8 reuses VCFA_ORGANIZATION as the vIDM domain. Trimmed for the same
      // reason buildVcfaLogin trims it before the provider check: a value typed
      // with a trailing space, or carried over from a CRLF file, is otherwise
      // rejected by the CSP login with an opaque 400 on a domain that looks
      // correct in the error message.
      domain: config.organization.trim(),
    },
  };
}

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
 * Uses the npm undici's fetch() (Node 22+); see requestFetch for why.
 */
export class VroHttpClient {
  readonly targetPlatform: VroTargetPlatform;
  readonly baseUrl: string;
  readonly eventBrokerBaseUrl: string;
  readonly catalogBaseUrl: string;
  readonly deploymentBaseUrl: string;
  readonly blueprintBaseUrl: string;
  readonly projectBaseUrl: string;
  readonly packageDir: string;
  readonly projectPackageName?: string;
  readonly projectPackageDescription?: string;
  readonly resourceDir: string;
  readonly workflowDir: string;
  readonly executionLogDir: string;
  readonly actionDir: string;
  readonly configurationDir: string;
  readonly contextDir: string;

  private readonly versionsUrl: string;
  private pinnedApiVersion: string | undefined;
  private negotiatedApiVersion: string | null = null;
  // Credential material for exactly one platform's login flow, so the process
  // never holds credentials the active mode cannot use: `vcfa` keeps only the
  // base64 Basic header for the session POST, `vra8` only the vIDM CSP login
  // body. authenticate() dispatches on the discriminant.
  private readonly login: VcfaLogin | Vra8Login;
  private token: string | null = null;
  // vra8 only: the refresh token from the CSP login. It is the long-lived
  // credential of the pair, so keeping it lets a token renewal replay just the
  // IaaS exchange instead of re-sending the password to the CSP gateway.
  private vra8RefreshToken: string | null = null;
  // Shared in-flight authentication so concurrent requests on a fresh or
  // expired session run one login sequence (vcfa: version probe plus session
  // POST; vra8: the IaaS exchange, plus the CSP login when no refresh token is
  // cached), not one each.
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
    this.projectBaseUrl = `https://${config.host}/project-service/api`;
    this.versionsUrl = `https://${config.host}/api/versions`;
    this.pinnedApiVersion = resolvePinnedApiVersion(config.targetPlatform);
    this.login =
      this.targetPlatform === "vra8"
        ? buildVra8Login(config)
        : buildVcfaLogin(config);
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

  private async ensureAuthenticated(): Promise<string> {
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
   * Fetch with this client's dispatcher under a single abort deadline that also
   * covers reading the response, and return whatever `consume` extracts from
   * it. One place owns the AbortController, the timeout, and the dispatcher for
   * every request this client makes: the version probe, both login flows, and
   * authenticated API calls (which pass the response straight through and read
   * the body themselves).
   */
  private async fetchWithTimeout<T>(
    url: string,
    init: DispatchedRequestInit,
    consume: (res: Response) => Promise<T>,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const dispatchedInit: DispatchedRequestInit = {
        ...init,
        signal: controller.signal,
        dispatcher: this.dispatcher,
      };
      const res = await requestFetch()(url, dispatchedInit);
      return await consume(res);
    } finally {
      clearTimeout(timeoutId);
    }
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

    try {
      const text = await this.fetchWithTimeout(
        this.versionsUrl,
        { method: "GET", headers: { Accept: "*/*" } },
        async (res) => {
          if (!res.ok) {
            throw new Error(`${res.status} ${res.statusText}`);
          }
          return res.text();
        },
      );
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
    }
    return this.negotiatedApiVersion;
  }

  private authenticate(): Promise<void> {
    return this.login.kind === "vra8"
      ? this.authenticateVra8(this.login)
      : this.authenticateVcfa(this.login);
  }

  /**
   * vRA 8 (embedded vRO) rejects Basic auth on /vco/api with 401 and
   * WWW-Authenticate: Bearer, so obtain a bearer token the documented way:
   *   1. POST /csp/gateway/am/api/login?access_token {username, password, domain}
   *      -> { refresh_token }
   *   2. POST /iaas/api/login { refreshToken } -> { token, tokenType: "Bearer" }
   * The refresh token is the long-lived half of that pair, so it is kept and a
   * later renewal replays only step 2: one round trip, and the password does
   * not go over the wire again. A cached refresh token the exchange no longer
   * accepts is dropped and the full two-step login runs once.
   * Token values, refresh tokens, and passwords are never logged or surfaced,
   * and 2xx bodies are never echoed into errors.
   */
  private async authenticateVra8(login: Vra8Login): Promise<void> {
    const cached = this.vra8RefreshToken;
    if (cached) {
      console.error(
        "[vro-client] Renewing the vRA 8 bearer token from the cached refresh token…",
      );
      const renewal = await this.postLoginJson(login.iaasLoginUrl, {
        refreshToken: cached,
      });
      const renewed = renewal.res.ok
        ? readStringField(renewal.text, "token")
        : undefined;
      if (renewed) {
        this.token = renewed;
        console.error("[vro-client] Bearer token renewed.");
        return;
      }
      // Expired, revoked, or an unhealthy exchange: drop the refresh token and
      // fall through to the full login rather than failing the request.
      console.error(
        "[vro-client] Cached refresh token was not accepted (%s); repeating the CSP login…",
        describeLoginFailure(renewal, "token"),
      );
      this.vra8RefreshToken = null;
    }

    console.error(
      "[vro-client] Authenticating via vRA 8 CSP login and IaaS token exchange…",
    );

    const csp = await this.postLoginJson(login.cspLoginUrl, login.body);
    if (!csp.res.ok) {
      const hint =
        csp.res.status === 400 || csp.res.status === 401 || csp.res.status === 403
          ? VRA8_LOGIN_HINT
          : "";
      throw new Error(
        `vRA 8 authentication failed (CSP login): ${describeLoginFailure(csp, "refresh_token")}${hint}`,
      );
    }
    const refreshToken = readStringField(csp.text, "refresh_token");
    if (!refreshToken) {
      throw new Error(
        `vRA 8 authentication failed (CSP login): ${describeLoginFailure(csp, "refresh_token")}`,
      );
    }

    const iaas = await this.postLoginJson(login.iaasLoginUrl, { refreshToken });
    if (!iaas.res.ok) {
      throw new Error(
        `vRA 8 authentication failed (IaaS token exchange): ${describeLoginFailure(iaas, "token")}`,
      );
    }
    const token = readStringField(iaas.text, "token");
    if (!token) {
      throw new Error(
        `vRA 8 authentication failed (IaaS token exchange): ${describeLoginFailure(iaas, "token")}`,
      );
    }

    this.vra8RefreshToken = refreshToken;
    this.token = token;
    console.error("[vro-client] Authentication successful, bearer token acquired.");
  }

  /**
   * POST a JSON login body with no Authorization header, reading the response
   * body so callers can sanitize or parse it.
   *
   * Redirects are not followed. The body carries the cleartext password, and a
   * 307/308 preserves the method and body across origins — the Fetch standard
   * strips an Authorization header on a cross-origin redirect, but nothing
   * strips a body — while a 302/303 would quietly turn the POST into a GET of
   * an SSO page and answer 200 with HTML. Both surface as login failures.
   */
  private postLoginJson(url: string, body: unknown): Promise<LoginResponse> {
    return this.fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        redirect: "manual",
      },
      readLoginResponse,
    );
  }

  private async authenticateVcfa(login: VcfaLogin): Promise<void> {
    const apiVersion = await this.negotiateApiVersion();
    console.error(
      `[vro-client] Authenticating via VCF Cloud API ${login.isProviderLogin ? "provider " : ""}sessions (version ${apiVersion})…`,
    );
    const { res, text } = await this.fetchWithTimeout(
      login.sessionUrl,
      {
        method: "POST",
        headers: {
          Authorization: login.header,
          "Content-Type": `application/json;version=${apiVersion}`,
          Accept: `application/json;version=${apiVersion}`,
        },
      },
      readLoginResponse,
    );

    if (!res.ok) {
      const hint =
        res.status === 401
          ? login.isProviderLogin
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
    return `Bearer ${await this.ensureAuthenticated()}`;
  }

  /**
   * Decide whether a rejected response earns one re-authentication.
   *
   * A 401 always does. On the vcfa platform a 403 does too: the Cloud API has
   * answered an unusable session with either status. In vra8 mode an expired
   * bearer token comes back as a 401 with a WWW-Authenticate challenge, while a
   * 403 from /vco/api normally means the vIDM user lacks the vRO permission —
   * repeating the two-step login cannot change that, so a challenge-less 403 is
   * surfaced immediately instead of costing an extra login and a retry that is
   * certain to fail the same way. (The vRA 8 status semantics here are the part
   * of that mode still pending lab verification under VCFO-068.)
   */
  private shouldReauthenticate(res: Response): boolean {
    if (res.status === 401) return true;
    if (res.status !== 403) return false;
    return this.targetPlatform !== "vra8" || res.headers.has("www-authenticate");
  }

  /**
   * Perform an authenticated fetch with automatic token refresh. If the
   * response is rejected in a way that a fresh token could fix (see
   * shouldReauthenticate) the token used for the attempt is invalidated, a
   * fresh one is obtained (vcfa: Cloud API session; vra8: IaaS exchange of the
   * cached refresh token, or the full CSP login), and the request is retried
   * exactly once. A second rejection is returned to the caller as-is.
   *
   * Callers receive the raw `Response` and are responsible for checking
   * `res.ok` and reading the body.
   */
  async authenticatedFetch(
    url: string,
    init: RequestInit & { headers: Record<string, string> },
    options?: { timeout?: number },
  ): Promise<Response> {
    const timeout = options?.timeout ?? REQUEST_TIMEOUT_MS;
    const attemptToken = await this.ensureAuthenticated();
    init.headers["Authorization"] = `Bearer ${attemptToken}`;

    // The response is handed back unread, so the deadline covers connecting
    // and the response headers; callers read the body themselves.
    const doFetch = (): Promise<Response> =>
      this.fetchWithTimeout(url, init, async (res) => res, timeout);

    const res = await doFetch();

    if (this.shouldReauthenticate(res)) {
      // Drain the rejected response body to release the socket promptly.
      res.body?.cancel().catch(() => {});
      console.error(
        "[vro-client] Received %d, re-authenticating and retrying once…",
        res.status,
      );
      // Invalidate only the token this attempt actually used. A concurrent
      // request may already have replaced it, and clearing a fresh token would
      // send every request whose 401 was already stale through another full
      // login — two round trips and a password resend in vra8 mode.
      if (this.token === attemptToken) {
        this.token = null;
      }
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
        `vRO API error: ${res.status} ${res.statusText} — ${method} ${path}\n${sanitizeErrorBody(text, res)}${this.apiErrorHint(res)}`,
      );
    }

    return { res, text: await res.text() };
  }

  /**
   * Extra guidance for a status that is easy to misread as a login problem. In
   * vra8 mode a 403 without an authentication challenge means the login worked
   * and the token is valid: the vIDM user simply has no permission here.
   *
   * Public because the binary-export and multipart-import paths call
   * authenticatedFetch directly and build their own error messages; they append
   * this so a 403 reads the same there as on the JSON path.
   */
  apiErrorHint(res: Response): string {
    if (
      res.status === 403 &&
      this.targetPlatform === "vra8" &&
      !res.headers.has("www-authenticate")
    ) {
      return "\nHint: the vRA 8 login succeeded, so this 403 is an authorization result, not an authentication one — the vIDM user has no permission for this vRO object or operation. Check the user's vRO permissions rather than VCFA_USERNAME, VCFA_PASSWORD, or VCFA_ORGANIZATION.";
    }
    return "";
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
