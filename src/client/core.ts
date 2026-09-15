import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Agent, fetch as undiciFetch, FormData as UndiciFormData } from "undici";
import { STATUS_CODES } from "node:http";
import type {
  VroClientConfig,
  VroTargetPlatform,
  VroTargetPlatformInput,
} from "../types.js";

// The Automation services vra8 mode can address. Writes are gated per service:
// VCFO-070 verified blueprint-service and event-broker against a vRA 8.18 lab,
// so those two now write; catalog-service and deployment-service stay withheld
// because that lab had no released catalog content and no deployment to act on,
// and exercising either one provisions or destroys real infrastructure.
type AutomationService =
  | "blueprint"
  | "catalog"
  | "deployment"
  | "event-broker"
  | "project";

// Exhaustive on purpose: `null` means writes to that service are lab-verified,
// a string is the refusal explaining what verifying it would take. Adding a
// service to AutomationService forces a decision here — and an entry in the
// base-URL map the constructor builds, which is exhaustive for the same reason
// — rather than defaulting into the permissive branch.
const UNSUPPORTED_AUTOMATION_WRITE: Record<AutomationService, string | null> =
  {
    blueprint: null,
    "event-broker": null,
    project:
      "Project-service writes are not supported in VCFA_TARGET_PLATFORM=vra8 mode: no write path has been verified against a vRA 8 environment. Reading projects is supported.",
    catalog:
      "Catalog item requests (create-deployment) are not supported in VCFA_TARGET_PLATFORM=vra8 mode pending lab verification: the lab that verified this mode had no released catalog content, so the request path was never exercised. Reading catalog items is supported, as are blueprint and subscription writes and the full vRO /vco/api surface.",
    deployment:
      "Deployment deletion and day-2 actions (delete-deployment, run-deployment-action) are not supported in VCFA_TARGET_PLATFORM=vra8 mode pending lab verification: the lab that verified this mode had no deployment to act on, and both paths destroy or alter real infrastructure. Reading deployments and their day-2 action lists is supported, as are blueprint and subscription writes and the full vRO /vco/api surface.",
  };

// Fallback for an Automation base URL this guard does not recognize. Both the
// refusal map and the base-URL map are keyed by AutomationService, so a new
// service cannot reach this without also skipping the type checker; it fails
// closed rather than letting the write through.
const UNSUPPORTED_AUTOMATION_WRITE_UNKNOWN =
  "This Automation-service write is not supported in VCFA_TARGET_PLATFORM=vra8 mode: the target service has not been verified against a vRA 8 environment.";

// vRA 8 serves a single configuration element as JSON only: a GET that asks
// for application/zip answers 406, while the same request for a workflow or an
// action returns the artifact (verified on vRO 8.18.1, VCFO-068). The package
// route is the working alternative and is named in the message.
export const UNSUPPORTED_VRA8_CONFIGURATION_EXPORT =
  "Exporting a single configuration element as a .vsoconf artifact is not supported in VCFA_TARGET_PLATFORM=vra8 mode: vRA 8 serves configuration elements as JSON only and rejects the artifact request with 406. Use get-configuration to read it, or add it to the project package with add-configuration-to-project-package and export that package instead.";

// The refusal is not confined to vRA 8, and it is specific to configuration
// elements rather than to artifact export. Both a standalone vRO 9.1 and an
// appliance-embedded vRO 9.1 answer 406 to every artifact Accept for a
// configuration element — application/zip, application/vcoobject+zip and
// application/octet-stream alike — while `*/*` returns the element as JSON.
// On those same hosts, in the same session, workflow, action and package
// exports all answer 200 application/zip, so the 406 is the element type
// being unsupported, not the identity or the host (verified live, VCFO-074).
// The vra8 guard above stays a pre-emptive fast path; this message is what a
// 406 from any other platform is turned into, so the operator gets the same
// actionable route instead of an opaque HTML error body. The wording still
// states only what the server answered, since no vRO is known to support it.
export const CONFIGURATION_EXPORT_NOT_ACCEPTABLE =
  "This vRO server does not serve a single configuration element as a .vsoconf artifact: it answered the export request with 406 Not Acceptable. Use get-configuration to read the element, or add it to the project package with add-configuration-to-project-package and export that package instead.";

// Appended to a 409 on a workflow, action or configuration delete. vRO names
// the remedy itself — "Specify '?force=true' parameter to delete it" — but an
// MCP caller cannot send a query parameter, so the hint re-spells it as the
// `force` argument the delete tools now take. vRO's own sentence is kept: it
// names the element and is the most informative part of the body, unlike the
// opaque HTML behind the 406 above. The likely cause is named because it was
// isolated to one sequence on VCF Automation 9.1: create an element, add it
// to a package, rebuild, then delete the package with deleteContents false.
// Deleting the same element while the package still exists, or after running
// it, both succeed — only orphaning it by the package delete trips the 409
// (VCFO-087).
export function inUseForceHint(tool: string): string {
  return `\nHint: vRO reports this element as in use. The usual cause is delete-package with deleteContents false, which leaves members behind as orphans on 9.x. Re-run ${tool} with force set to true to delete it anyway, once nothing that matters still references it.`;
}

// Appended to vRA 8 login failures. The CSP login answers wrong credentials
// and unknown domains with 400 (not 401), so the hint covers both.
const VRA8_LOGIN_HINT =
  '\nHint: in VCFA_TARGET_PLATFORM=vra8 mode, VCFA_USERNAME and VCFA_PASSWORD are the vIDM (Workspace ONE Access) credentials and VCFA_ORGANIZATION is the vIDM domain shown on the login page, for example "System Domain" for local users.';

// Appended to a 403, or to a 500, from one of the five Automation services
// while the session is a provider one. Those services are tenant-scoped, and a
// provider identity has no auth-context in that stack: on VCF Automation 9.1
// project-service answers 403 while catalog-, deployment-, blueprint- and
// event-broker-service answer 500, two of them naming the refused
// rbac-service/api/auth-context call as the cause (VCFO-085). vRO is
// unaffected and answers 200 on the same session, which is what makes the
// symptom confusing enough to be worth a hint. The server-error arm is that
// one status, not the 5xx range: 502, 503 and 504 are emitted by whatever sits
// in front of the service rather than by the service itself, so they cannot
// carry this signature and must not be diagnosed as a configuration mistake.
const PROVIDER_SESSION_AUTOMATION_HINT =
  "\nHint: the VCF Automation services are tenant-scoped and a provider session carries no tenant context, so VCFA_ORGANIZATION=system cannot read them. Set VCFA_ORGANIZATION to the tenant organization's name (its URL slug) to use the catalog, deployment, template, event topic, subscription, and project tools; vRO (/vco/api) works on either session.";

// The reassurance every settled 403 carries: one sentence with three slots —
// which login ran, what was denied, and what to audit instead. The shared half
// says the credentials are not the problem, so it is written once; a variant
// differs only in its slots.
const authorizationHint = (
  login: string,
  denied: string,
  check: string,
): string =>
  `\nHint: the ${login} succeeded, so this 403 is an authorization result, not an authentication one — ${denied}. Check ${check} rather than VCFA_USERNAME, VCFA_PASSWORD, or VCFA_ORGANIZATION.`;

// Appended to an Automation-service 403 on a session that is not a provider
// one: the login worked, so the refusal is about the user's roles, not their
// credentials. Names no platform, because both reach these services.
const AUTOMATION_AUTHORIZATION_HINT = authorizationHint(
  "login",
  "the user lacks the role this VCF Automation service requires",
  "the user's roles",
);

// The same reassurance for a vRO 403, worded per platform. Both say the login
// is not the problem; only the credential variables differ in relevance.
const VRA8_AUTHORIZATION_HINT = authorizationHint(
  "vRA 8 login",
  "the vIDM user has no permission for this vRO object or operation",
  "the user's vRO permissions",
);
const VCFA_AUTHORIZATION_HINT = authorizationHint(
  "VCF Automation login",
  "the user has no permission for this vRO object or operation",
  "the user's vRO permissions",
);

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
 * Render `<status> <reason>` for an error message. Responses over HTTP/2 carry
 * no reason phrase, so `Response.statusText` is frequently empty there; the
 * standard phrase for the code fills in so a message never reads `400  —`.
 */
export function formatStatus(res: Response): string {
  const reason = res.statusText || STATUS_CODES[res.status] || "";
  return reason ? `${res.status} ${reason}` : String(res.status);
}

/**
 * HTTP status carried by an error built with `VroHttpClient.apiError`, or
 * undefined for any other error. Lets a caller branch on the status without
 * parsing the message text.
 */
export function apiErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/**
 * How a body that is neither JSON nor a recognizable HTML page is rendered by
 * sanitizeErrorBody. `excerpt` (the default) quotes its first
 * NON_JSON_BODY_LIMIT characters; `shape` reports only its size and declared
 * content type, for responses to requests whose own body is secret and could
 * be reflected back — the login POSTs.
 */
export type NonJsonBodyMode = "excerpt" | "shape";

/**
 * Sanitize a raw HTTP response body before including it in a thrown error.
 * Extracts only known-safe diagnostic fields from JSON bodies; summarizes
 * gateway HTML pages; truncates (or, in `shape` mode, merely measures) other
 * non-JSON bodies. Never surfaces unbounded raw response content.
 * Optionally prepends a correlation ID header when res is provided.
 */
export function sanitizeErrorBody(
  rawText: string,
  res?: Response,
  nonJson: NonJsonBodyMode = "excerpt",
): string {
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

  const htmlSummary = summarizeHtmlErrorPage(rawText);
  if (htmlSummary) {
    parts.push(htmlSummary);
    return parts.join("\n");
  }

  if (nonJson === "shape") {
    const contentType = res?.headers.get("content-type") ?? "unknown";
    parts.push(
      `[non-JSON body: ${rawText.length} characters, content-type ${contentType}, not echoed]`,
    );
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
 * Summarize a gateway HTML error page, or return undefined for a body that is
 * not one.
 *
 * The vRA 8 gateway answers a rejected /vco/api request with a styled HTML
 * page whose only diagnostic content is the status code and reason, several
 * hundred bytes into a stylesheet. Truncating that to NON_JSON_BODY_LIMIT
 * yields CSS boilerplate and nothing else, which is how a real 400 came to
 * read as `vRO API error: 400  — POST /configurations` with no usable detail
 * (VCFO-068). The reason phrase matters more here than it looks: these
 * responses arrive over HTTP/2, which has no reason phrase, so Response
 * .statusText is empty and the page's own text is the only place it survives.
 *
 * Only the two short status fields are lifted out; the surrounding markup is
 * never echoed, and a page without them is reported as carrying no detail
 * rather than being quoted.
 */
function summarizeHtmlErrorPage(rawText: string): string | undefined {
  if (!/^\s*(?:<!doctype html|<html[\s>])/i.test(rawText)) return undefined;
  const status = matchHtmlStatusField(rawText, "status-code");
  const message = matchHtmlStatusField(rawText, "status-message");
  const detail = [status, message].filter(Boolean).join(" ");
  // "HTML body", not "error page": sanitizeErrorBody also renders the
  // non-JSON 2xx path, where the same markup is a gateway or maintenance page
  // rather than a rejection.
  return detail
    ? `[HTML body: ${detail} — no further detail]`
    : "[HTML body with no diagnostic detail]";
}

// Read one `<div class="<field>">text</div>` value, capped so a crafted page
// cannot pad the error message. Returns undefined when absent or empty.
function matchHtmlStatusField(
  rawText: string,
  field: string,
): string | undefined {
  const match = new RegExp(
    `class="${field}"[^>]*>([^<]{1,40})<`,
    "i",
  ).exec(rawText);
  const value = match?.[1]?.trim();
  return value ? value : undefined;
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
 * Name the host an absolute URL addresses: the target a redirect points at,
 * for a login or API failure message, or the destination of a request that
 * never completed. Returns undefined for a relative or malformed value; only
 * the host is ever used, never the full URL, which can carry token material in
 * its query.
 */
function urlHost(value: string): string | undefined {
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

/**
 * Name the host a transport-level failure was addressed to. undici reports
 * DNS, connection, and TLS failures as a bare `TypeError: fetch failed` with
 * the detail on `cause`, and the tools render only `message`, so a typo in a
 * hostname used to surface as "fetch failed" with no host at all — terse with
 * one host, ambiguous once /vco/api can live on a second one. The original
 * error is kept as `cause` for callers that inspect it (VCFO-081).
 */
function describeTransportFailure(
  url: string,
  error: unknown,
  timeoutMs?: number,
): Error {
  // urlHost never echoes the full URL, which carries the query: an unparsable
  // target leaves the failure unattributed rather than leaking one.
  const host = urlHost(url);
  const target = host ? `Request to ${host}` : "Request";
  const outer = error instanceof Error ? error : undefined;
  // Only a deadline-bearing call can time out. A body read runs after the
  // deadline is cleared, so an abort there is reported as a plain failure.
  if (timeoutMs !== undefined && outer?.name === "AbortError") {
    return Object.assign(
      new Error(`${target} timed out after ${timeoutMs} ms`),
      { cause: error },
    );
  }
  const inner: unknown = outer?.cause;
  const code =
    inner !== null &&
    typeof inner === "object" &&
    "code" in inner &&
    typeof inner.code === "string"
      ? inner.code
      : undefined;
  const detail =
    (inner instanceof Error ? inner.message : undefined) ?? outer?.message;
  // Lead with the code so it stays grep-able, but never at the cost of the
  // message: undici's UND_ERR_* codes say far less than the text beside them,
  // and a DNS failure's text names the host that could not be resolved.
  const reason =
    code && detail && detail !== code
      ? `${code}: ${detail}`
      : (code ?? detail ?? String(error));
  return Object.assign(new Error(`${target} failed: ${reason}`), {
    cause: error,
  });
}

/**
 * Describe why a login response was unusable, in a form that is safe to
 * surface. A redirect names the host it points at; another non-2xx reports its
 * status plus the sanitized body — JSON diagnostic fields and gateway HTML
 * summaries only, never a raw non-JSON excerpt, because a login request carries
 * the credentials — the password or the refresh token in the vra8 body, the
 * Basic header on the vcfa session POST — and a gateway that reflects a
 * rejected request would otherwise echo them; a 2xx that did not carry
 * `expectedField` reports the status, the declared content type, and the shape
 * of the body (unreadable, empty, non-JSON, or JSON without the field) but
 * never the body itself, because a login 2xx body can carry token material.
 */
function describeLoginFailure(
  result: LoginResponse,
  expectedField: string,
): string {
  const { res, text, bodyError } = result;
  const status = formatStatus(res);

  if (bodyError) {
    return `${status} but the response body could not be read: ${bodyError}`;
  }

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    const host = location ? urlHost(location) : undefined;
    return `${status}: the login endpoint answered with a redirect${host ? ` to ${host}` : ""}, which is not followed because the request carries the credentials. Verify VCFA_HOST addresses the appliance's API endpoint directly, with no SSO or load-balancer redirect in front of it.`;
  }

  if (!res.ok) {
    return `${status}\n${sanitizeErrorBody(text, res, "shape")}`;
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
  const isProviderLogin = config.organization.toLowerCase() === "system";
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
      // vra8 reuses VCFA_ORGANIZATION as the vIDM domain (already trimmed by
      // the VroHttpClient constructor).
      domain: config.organization,
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
  /** Base URL per Automation service, the reverse lookup the write guard uses. */
  private readonly automationBaseUrls: Record<AutomationService, string>;
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
  /**
   * The external vRO host, when one is configured and differs from the
   * Automation host: only /vco/api is served there, so a request label can say
   * which appliance answered. Undefined means the embedded vRO. Public because
   * this constructor is the one place that decides whether the hosts are
   * split, so the startup routing log reports it instead of re-deriving the
   * same rule (VCFO-081).
   */
  readonly externalVroHost: string | undefined;
  // The Automation host, verbatim. Together with externalVroHost it supplies
  // both request labels, so no request has to parse a base URL back to a host.
  private readonly automationHost: string;
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

  constructor(rawConfig: VroClientConfig) {
    // VCFA_ORGANIZATION is normalized once, here, for every consumer: the
    // provider-login check, the vcfa Basic header, and the vra8 vIDM domain.
    // A trailing space or CR — easy to acquire in a value that legitimately
    // contains a space, such as `System Domain`, or carried over from a CRLF
    // file — otherwise reaches the login as part of the credential and comes
    // back as an opaque 400 or 401 on a value that looks correct.
    const config: VroClientConfig = {
      ...rawConfig,
      host: rawConfig.host.trim(),
      organization: rawConfig.organization.trim(),
      // Blank counts as unset so an empty VCFA_VRO_HOST does not become
      // https:///vco/api. A host with surrounding whitespace could never have
      // connected, so trimming both hosts changes no working configuration.
      vroHost: rawConfig.vroHost?.trim() || undefined,
    };
    this.targetPlatform = normalizeTargetPlatform(config.targetPlatform);
    this.dispatcher = config.ignoreTls
      ? new Agent({ connect: { rejectUnauthorized: false } })
      : undefined;
    // An external vRO appliance serves /vco/api on its own host. Only that base
    // follows it: the session/CSP/IaaS logins, GET /api/versions, and the five
    // Automation services stay on config.host, and the token the Automation
    // appliance mints is sent verbatim to the vRO host — verified live on VCF
    // Automation 9.1 with an external vRO 9.1 (VCFO-081). An override equal to
    // config.host is no split at all and is treated as unset.
    this.externalVroHost =
      config.vroHost !== undefined && config.vroHost !== config.host
        ? config.vroHost
        : undefined;
    this.automationHost = config.host;
    this.baseUrl = `https://${this.externalVroHost ?? config.host}/vco/api`;
    this.eventBrokerBaseUrl = `https://${config.host}/event-broker/api`;
    this.catalogBaseUrl = `https://${config.host}/catalog/api`;
    this.deploymentBaseUrl = `https://${config.host}/deployment/api`;
    this.blueprintBaseUrl = `https://${config.host}/blueprint/api`;
    this.projectBaseUrl = `https://${config.host}/project-service/api`;
    this.automationBaseUrls = {
      blueprint: this.blueprintBaseUrl,
      catalog: this.catalogBaseUrl,
      deployment: this.deploymentBaseUrl,
      "event-broker": this.eventBrokerBaseUrl,
      project: this.projectBaseUrl,
    };
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
      let res: Response;
      try {
        res = await requestFetch()(url, dispatchedInit);
      } catch (error) {
        throw describeTransportFailure(url, error, timeoutMs);
      }
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
    // Redirects are not followed. The credentials ride in the Basic
    // Authorization header, which the Fetch standard strips on a cross-origin
    // redirect, so a followed redirect could only ever reach an SSO portal or
    // UI unauthenticated and answer 200 with HTML — which used to surface as a
    // missing token header, naming nothing. An external vRO appliance answers
    // this endpoint with exactly that redirect (VCFO-082).
    const result = await this.fetchWithTimeout(
      login.sessionUrl,
      {
        method: "POST",
        headers: {
          Authorization: login.header,
          "Content-Type": `application/json;version=${apiVersion}`,
          Accept: `application/json;version=${apiVersion}`,
        },
        redirect: "manual",
      },
      readLoginResponse,
    );
    const { res } = result;

    if (!res.ok) {
      const hint =
        res.status === 401
          ? login.isProviderLogin
            ? "\nHint: provider logins use the system organization — verify the username is a provider/system administrator account and the password is correct."
            : '\nHint: VCFA_ORGANIZATION must be the organization name (the tenant URL slug), not its display name. Provider/system administrators must set VCFA_ORGANIZATION=system, which routes the login to /cloudapi/1.0.0/sessions/provider.'
          : "";
      throw new Error(
        `VCF authentication failed: ${describeLoginFailure(result, "x-vmware-vcloud-access-token")}${hint}`,
      );
    }

    // A 2xx that carries no token is not a success. A host that answers the
    // session POST with an SSO page rather than redirecting to one lands here,
    // so the status and the declared content type are named; the body never is,
    // because a login 2xx body can carry token material.
    const token = res.headers.get("x-vmware-vcloud-access-token");
    if (!token) {
      const contentType = res.headers.get("content-type") ?? "none";
      throw new Error(
        `VCF authentication failed: ${formatStatus(res)} did not carry the x-vmware-vcloud-access-token header (content-type: ${contentType}). Verify VCFA_HOST addresses the appliance's API endpoint directly, with no SSO or load-balancer redirect in front of it.`,
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
   * A 401 always does. A 403 never does: it is an authorization result, and
   * repeating the login cannot change it — the one exception is vra8, where a
   * 403 carrying a WWW-Authenticate challenge is how an unusable token can
   * present (VCFO-068, verified against a vRA 8.18 lab: an invalid or expired
   * token answers 401 with a challenge on /vco/api and on the Automation
   * services alike, while a genuine denial answers 403 with none).
   *
   * The vcfa rule used to be the opposite — every non-HTML 403 was retried, on
   * the VCFO-038 assumption that "the Cloud API has answered an unusable
   * session with either status". Measured against a VCF Automation 9.1 lab
   * under VCFO-083/VCFO-085, it does not: a revoked session answers 401
   * (`The token is not valid or revoked.`), an absent or malformed token
   * answers 401 on /vco/api and on all five Automation services, and every
   * observed 403 there was a real denial — a vRO permission refusal, or a
   * provider session reaching the tenant-scoped Automation services.
   *
   * The challenge is deliberately *not* consulted on vcfa. It is not a
   * discriminator there: /vco/api, catalog-, deployment- and blueprint-service
   * omit it even on a 401, while project-service sends `WWW-Authenticate:
   * Bearer` on a 403 that is a genuine denial — so keying on it would retry
   * exactly the case this rule exists to stop.
   */
  private shouldReauthenticate(res: Response): boolean {
    if (res.status === 401) return true;
    if (res.status !== 403) return false;
    return this.targetPlatform === "vra8" && res.headers.has("www-authenticate");
  }

  /**
   * Whether a 403 is a settled authorization denial — one a fresh token cannot
   * turn into a 200 — and so earns a hint saying the credentials are fine.
   *
   * The same rule as shouldReauthenticate above, stated positively rather than
   * read backwards through it, because on `vcfa` the negation is a constant:
   * every 403 there is settled (VCFO-083), so `!shouldReauthenticate(res)`
   * would read as a live two-platform guard while only ever discriminating on
   * `vra8`. There the challenge is the discriminator, and a challenge-carrying
   * 403 that survives its one retry is left unhinted, since "the login
   * succeeded" is exactly what it disputes (VCFO-068).
   */
  private isSettledDenial(res: Response): boolean {
    if (res.status !== 403) return false;
    return this.targetPlatform !== "vra8" || !res.headers.has("www-authenticate");
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
   *
   * Redirects use fetch's default unless the caller asks for
   * `redirect: "manual"`. The JSON API path (`send`) does: fetch strips
   * `Authorization` on a cross-origin redirect, so following one can only ever
   * reach a UI or SSO page unauthenticated, and a followed 302 then
   * masquerades as a 200 HTML body that fails JSON parsing with no host named.
   * Surfacing the 3xx instead lets apiErrorHint name the redirect target and
   * the variable to check, which is how a VCFA_VRO_HOST pointing at the wrong
   * appliance shows up. The binary-export and multipart-import paths keep the
   * default, so a same-origin redirect they relied on before is still followed
   * (VCFO-081).
   */
  async authenticatedFetch(
    url: string,
    init: RequestInit & { headers: Record<string, string> },
    options?: { timeout?: number; redirect?: RequestRedirect },
  ): Promise<Response> {
    const timeout = options?.timeout ?? REQUEST_TIMEOUT_MS;
    const redirect: RequestRedirect = options?.redirect ?? "follow";
    const attemptToken = await this.ensureAuthenticated();
    init.headers["Authorization"] = `Bearer ${attemptToken}`;

    // The response is handed back unread, so the deadline covers connecting
    // and the response headers; callers read the body themselves.
    const doFetch = (): Promise<Response> =>
      this.fetchWithTimeout(
        url,
        { ...init, redirect },
        async (res) => res,
        timeout,
      );

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

  /** Which Automation service an override base URL belongs to, if any. */
  private automationServiceFor(
    baseUrl: string,
  ): AutomationService | undefined {
    const services = Object.keys(this.automationBaseUrls) as AutomationService[];
    return services.find(
      (service) => this.automationBaseUrls[service] === baseUrl,
    );
  }

  /**
   * Gate an operation the active target platform cannot serve.
   *
   * Only `vra8` restricts anything, and after the VCFO-068 and VCFO-070 lab
   * verifications the restriction is per service and per method:
   *
   * - `/vco/api` (vRO): fully supported, reads and writes alike. Verified
   *   against vRO 8.18.1 — create/update/delete of workflows, actions, and
   *   configuration elements, plus package import and its dry-run details.
   *   The binary export and multipart import paths reach vRO through
   *   authenticatedFetch and are therefore never gated here.
   * - Automation services: reads are supported everywhere. The list and get
   *   paths return the same Spring `Page` and object shapes the VCFA 9.x
   *   clients parse (verified on vRA 8.18).
   * - Automation writes: blueprint-service and event-broker are verified
   *   (VCFO-070) and write; catalog-service, deployment-service, and
   *   project-service are not and throw. project-service has no write path
   *   today, so its entry only matters if one is added later.
   */
  private assertOperationSupported(
    method: string,
    overrideBaseUrl?: string,
  ): void {
    if (this.targetPlatform !== "vra8") return;
    if (!overrideBaseUrl || overrideBaseUrl === this.baseUrl) return;
    if (method.toUpperCase() === "GET") return;
    const service = this.automationServiceFor(overrideBaseUrl);
    if (service === undefined) {
      throw new Error(UNSUPPORTED_AUTOMATION_WRITE_UNKNOWN);
    }
    const refusal = UNSUPPORTED_AUTOMATION_WRITE[service];
    if (refusal !== null) throw new Error(refusal);
  }

  /**
   * `GET /workflows`, or `GET /workflows on vro.example.com` once an external
   * vRO host is configured, so a log line or an error says which appliance
   * answered. Applied to every request: the JSON path in `send` below, and the
   * binary-export and multipart-import paths in the artifact clients, which
   * label their own operations and call this directly. Both names come from
   * the configured host strings, so a host that `new URL` cannot parse fails
   * as a request, not as a thrown `Invalid URL` from building a log line. When
   * the hosts are not split the label is unchanged (VCFO-081).
   */
  requestLabel(operation: string, base: string = this.baseUrl): string {
    if (!this.externalVroHost) return operation;
    const host =
      base === this.baseUrl ? this.externalVroHost : this.automationHost;
    return `${operation} on ${host}`;
  }

  /**
   * Read a response body, naming the host when the transport fails partway —
   * a reset connection, a truncated response. The request deadline is already
   * cleared by then, so such a failure would otherwise surface as a bare
   * `TypeError: terminated` with no host at all (VCFO-081).
   */
  private async readBody(res: Response, url: string): Promise<string> {
    try {
      return await res.text();
    } catch (error) {
      throw describeTransportFailure(url, error);
    }
  }

  private async send(
    method: string,
    path: string,
    body?: unknown,
    overrideBaseUrl?: string,
  ): Promise<{ res: Response; text: string }> {
    this.assertOperationSupported(method, overrideBaseUrl);
    const base = overrideBaseUrl ?? this.baseUrl;
    const url = `${base}${path}`;
    const label = this.requestLabel(`${method} ${path}`, base);
    console.error(`[vro-client] ${label}`);

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
      // A followed 302 arrives here as a 200 HTML body that fails JSON
      // parsing with no host named; the 3xx itself is the useful answer.
      { redirect: "manual" },
    );

    if (!res.ok) {
      throw await this.apiError(res, label, base);
    }

    return { res, text: await this.readBody(res, url) };
  }

  /**
   * Build the error for a rejected vRO or Automation-service response: status
   * and reason, the operation label, the sanitized body, and any platform hint.
   * Reads and consumes the response body. The one owner of this message shape,
   * used by the JSON path here and by the binary-export and multipart-import
   * paths in the artifact clients, which call authenticatedFetch directly.
   * The HTTP status is attached as `status` for `apiErrorStatus`.
   *
   * `base` is the base URL the request used, so a hint can be limited to the
   * service it applies to. It defaults to the vRO base, which is what the
   * artifact clients always address.
   */
  async apiError(
    res: Response,
    label: string,
    base: string = this.baseUrl,
  ): Promise<Error> {
    const text = await res.text().catch(() => "");
    return Object.assign(
      new Error(
        `vRO API error: ${formatStatus(res)} — ${label}\n${sanitizeErrorBody(text, res)}${this.apiErrorHint(res, text, base)}`,
      ),
      { status: res.status },
    );
  }

  /**
   * Extra guidance for a status that is easy to misread as a login problem.
   *
   * - A 3xx: the JSON path asks authenticatedFetch not to follow redirects, so
   *   one surfaces here with its status. The configured host is then not the API endpoint
   *   — an SSO portal, a UI, or a load balancer — and the hint names the
   *   redirect target (host only, never the query, which can carry a ticket).
   * - A vcfa 403 with an HTML body on a /vco/api request while no external
   *   vRO host is configured: the Automation appliance's embedded
   *   orchestrator refusing a tenant whose organization is wired to an
   *   external vRO. vRO itself answers JSON, so the HTML body is the tell; the
   *   wording is hedged because the signature was observed on one appliance.
   *   The base check matters — VCFA_VRO_HOST moves only /vco/api, so the same
   *   HTML 403 from catalog-, deployment-, blueprint-, or project-service
   *   would be pointing the operator at a variable that cannot affect it
   *   (VCFO-081).
   * - A refusal from an Automation service: a provider session cannot read
   *   those at all, so a 403 or a 500 there names VCFA_ORGANIZATION, while
   *   any other session's 403 is about the user's roles (VCFO-085). The
   *   server-error arm is limited to provider sessions — and to 500, the
   *   status those services actually answer with — because only there is a
   *   server error the known symptom rather than an actual fault; a 502, 503
   *   or 504 comes from whatever fronts the service and means it is down.
   *   Both platforms reach these services, so neither arm is vcfa-only: the
   *   provider one narrows itself through the login's own discriminant.
   * - A settled 403 (see isSettledDenial): the login worked and the token is
   *   valid — the user simply has no permission. On vcfa that is every vRO
   *   403 (VCFO-083); on vra8, one carrying no challenge.
   *
   * Only the HTML-403 arm reads `text`, the body apiError already read and
   * sanitized; every other arm decides from the status, the headers, the base
   * and the login, so a large 5xx body is never scanned.
   */
  private apiErrorHint(res: Response, text: string, base: string): string {
    if (res.status >= 300 && res.status < 400) {
      const host = urlHost(res.headers.get("location") ?? "");
      return `\nHint: the API answered with a redirect${host ? ` to ${host}` : ""}, which is not followed. Verify the configured host addresses the API endpoint directly — VCFA_HOST, or VCFA_VRO_HOST for /vco/api — with no SSO or load-balancer redirect in front of it.`;
    }
    if (
      res.status === 403 &&
      this.targetPlatform === "vcfa" &&
      this.externalVroHost === undefined &&
      base === this.baseUrl &&
      summarizeHtmlErrorPage(text) !== undefined
    ) {
      return "\nHint: the Automation appliance answered 403 with an HTML page rather than a vRO JSON error. If this organization uses an external vRO appliance, the appliance's embedded orchestrator is the wrong target for /vco/api: set VCFA_VRO_HOST to the external vRO's hostname. Otherwise check the user's vRO permissions.";
    }
    if (this.automationServiceFor(base) !== undefined) {
      const providerSession =
        this.login.kind === "vcfa" && this.login.isProviderLogin;
      if (providerSession && (res.status === 403 || res.status === 500)) {
        return PROVIDER_SESSION_AUTOMATION_HINT;
      }
      if (this.isSettledDenial(res)) return AUTOMATION_AUTHORIZATION_HINT;
      // No bare return here: anything else falls through to the tail, which
      // answers only a settled 403 — and every settled Automation 403 was
      // already answered by one of the two arms above, so neither can double.
    }
    if (this.isSettledDenial(res)) {
      return this.targetPlatform === "vra8"
        ? VRA8_AUTHORIZATION_HINT
        : VCFA_AUTHORIZATION_HINT;
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
        `vRO API error: non-JSON response body (${formatStatus(res)}) — ${method} ${path}\n${sanitizeErrorBody(text, res)}`,
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
