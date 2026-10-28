# Client Layer

**Purpose:** how `src/client/` authenticates against each target platform, routes requests to hosts, builds errors, and keeps artifact files inside their directories.

## Key Files

| Path | Role |
| --- | --- |
| `src/client/core.ts` | `VroHttpClient`: login flows, version negotiation, token cache and refresh, request plumbing, error text and hints, vRA 8 write gating |
| `src/client/index.ts` | `VroClient` facade: builds one shared `VroHttpClient` and the domain clients, and delegates |
| `src/client/*-client.ts` | Endpoint paths and response parsing per domain |
| `src/client/pagination.ts` | Page walking: 100 items per page, at most 1,000 page requests (`DEFAULT_PAGE_SIZE` and `MAX_PAGE_REQUESTS` in `src/client/pagination.ts`) |
| `src/client/files.ts` | Artifact path safety |
| `src/client/artifact-preflight.ts`, `src/client/workflow-artifact.ts` | Local archive validation and `.workflow` building |
| `src/client/context-snapshot.ts` | Collects domains and writes the JSON and Markdown snapshot pair |

## How It Works

### Login Per Platform

- **`vcfa`** (the default), plus **`vcfa9.0`** and **`vcfa9.1`**, which pin the API version:
  - The client sends Basic credentials to `/cloudapi/1.0.0/sessions`.
  - An organization of `system`, in any case, goes to the provider endpoint `/sessions/provider` instead (`buildVcfaLogin` in `src/client/core.ts`).
  - The bearer token comes back in a response header.
  - Login redirects are not followed. Fetch strips the Basic header on a cross-origin redirect, so a followed redirect could only reach an SSO page and answer `200` with HTML (`authenticateVcfa` in `src/client/core.ts`).
- **API version.** A pinned version wins. Otherwise the client probes the unauthenticated `GET /api/versions` and prefers `9.1.0`, then `9.0.0` (`negotiateApiVersion` in `src/client/core.ts`).
- **`vra8`:**
  - A CSP login with the organization as the vIDM domain returns a refresh token.
  - `/iaas/api/login` exchanges that refresh token for the bearer token (`buildVra8Login` in `src/client/core.ts`).
  - Renewal reuses the cached refresh token and repeats only the exchange (`authenticateVra8` in `src/client/core.ts`).
  - Login redirects are not followed here either. The CSP login body carries the password, and a `307` or `308` would resend it to the new origin (`postLoginJson` in `src/client/core.ts`).
- **Lazy, shared login.** The first request triggers login, and concurrent requests share the one in-flight attempt (`startAuthentication` in `src/client/core.ts`).
- **Retry.** `authenticatedFetch` retries once after re-authenticating. That happens on `401`, and on `vra8` also on a `403` that carries `WWW-Authenticate` (`shouldReauthenticate` in `src/client/core.ts`). A `vcfa` `403` is never retried.

### Hosts And Base URLs

- The vRO base is `https://` plus `VCFA_VRO_HOST` (or `VCFA_HOST`) plus `/vco/api`.
- The Automation services, login, and `/api/versions` always use `VCFA_HOST` (`automationBaseUrls` in `src/client/core.ts`).
- While the two hosts differ, every request label ends with ` on ` and the host that answered (`requestLabel` in `src/client/core.ts`).

### Requests

- All requests use the npm `undici` `fetch` and `FormData`, never Node's global ones (`requestFetch` and `createUploadForm` in `src/client/core.ts`).
- `VCFA_IGNORE_TLS=true` gives the client its own `Agent` instead of touching process-wide TLS settings (`dispatcher` in `src/client/core.ts`).
- Timeouts are 30 s by default (`REQUEST_TIMEOUT_MS` in `src/client/core.ts`) and 60 s for binary export and import, which the domain clients pass per request.
- Domain clients call `http.get`, `post`, `put`, or `del` with an optional Automation base URL. Binary paths use `authenticatedFetch`, `apiError`, and `requestLabel` directly.
- **vRA 8 gating.** On `vra8`, a non-GET request to an Automation service whose writes are not lab-verified throws before any network call (`assertOperationSupported` in `src/client/core.ts`). The refusal text lives in the `UNSUPPORTED_AUTOMATION_WRITE` map in the same file.

### Errors

- `apiError` builds the message `vRO API error: <status> <reason> — <label>`, followed by a sanitized body and an optional hint. It attaches the numeric `status` (`apiError` in `src/client/core.ts`).
- `sanitizeErrorBody` in `src/client/core.ts`:
  - keeps a few known JSON error keys;
  - summarizes HTML gateway pages;
  - truncates everything else;
  - never echoes a login response body.
- `apiErrorHint` in the same file appends guidance for:
  - redirects;
  - an HTML `403` from the embedded vRO, pointing at `VCFA_VRO_HOST`;
  - a provider session reading tenant-scoped Automation services (`403` or `500`);
  - settled authorization denials.
- Domain clients add operation-specific hints. Example: the `409` in-use delete hint that says to retry before forcing (`inUseForceHint` in `src/client/core.ts`).
- Callers branch on `apiErrorStatus(error)`, exported from `src/client/core.ts`.
- Symptoms and fixes are in [Troubleshooting](../operations/troubleshooting.md).

### Artifact File Safety (`src/client/files.ts`)

- `resolveFileInDirectory` rejects absolute names and names with separators. It realpaths the root and refuses any target outside it.
- Exports refuse a symbolic-link target and create files exclusively unless `overwrite` is set (`exportWorkflowFile` in `src/client/workflow-client.ts`).
- Imports run preflight, reject a symbolic-link source, and check that the real path stays inside the directory (`importWorkflowFile` in `src/client/workflow-client.ts`).
- User-facing rules are in [Safety](../operations/safety.md#artifact-path-safety).

## Extension Points

- **New endpoint in an existing domain:** a method on that `*-client.ts`, plus a delegating method on the facade in `src/client/index.ts`.
- **New Automation service:** extend `AutomationService` and both exhaustive maps in `src/client/core.ts`, `UNSUPPORTED_AUTOMATION_WRITE` and `automationBaseUrls`. Decide vRA 8 write support explicitly: `null` means verified, and a string is the refusal.
- **New hint:** a constant beside the existing ones near the top of `src/client/core.ts`, appended where the operation knows its context.

## Gotchas

- The `vra8` CSP URL must keep the bare literal `?access_token`. `URLSearchParams` would emit `?access_token=` and the login would return the wrong token type (`buildVra8Login` in `src/client/core.ts`).
- Version negotiation behaves differently by outcome:
  - A failed `/api/versions` probe falls back to `9.0.0` for that attempt only and retries on the next authentication.
  - A probe that answers but lists no known version caches the fallback (`negotiateApiVersion` in `src/client/core.ts`).
  - Pin `vcfa9.0` or `vcfa9.1` to skip the probe.
- Other working gotchas are in the Gotchas section of `AGENTS.md`.
- The provider-session hint applies only to an exact `500`, not to `502`, `503`, or `504`.
- The pagination cap can stop a walk early. Tools must surface that with `truncationNote`; see [MCP Surface](./mcp-surface.md).
