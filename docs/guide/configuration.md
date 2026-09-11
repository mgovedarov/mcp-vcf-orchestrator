# Configuration

The server reads all runtime configuration from environment variables.

## Required Variables

| Variable | Required | Description |
| --- | --- | --- |
| `VCFA_HOST` | Yes | VCF Automation hostname, for example `vcfa.example.com`. |
| `VCFA_USERNAME` | Yes | Username without organization, for example `admin`. |
| `VCFA_ORGANIZATION` | Yes | Organization name (the tenant URL slug, not the display name), or `system` for provider/system administrator logins. In `vra8` mode, the vIDM domain shown on the Workspace ONE login page, for example `System Domain`. |
| `VCFA_PASSWORD` | Yes | Password for the VCF Cloud API session, or the vIDM password used for the vRA 8 login when `VCFA_TARGET_PLATFORM=vra8`. |

On the default `vcfa` platform, the server authenticates by sending Basic Auth as `{VCFA_USERNAME}@{VCFA_ORGANIZATION}:{VCFA_PASSWORD}` to the VCF Cloud API session endpoint. Tenant logins use:

```text
https://{VCFA_HOST}/cloudapi/1.0.0/sessions
```

When `VCFA_ORGANIZATION` is `system` (case-insensitive), the login is routed to the dedicated provider endpoint instead — the tenant endpoint rejects provider accounts with 401:

```text
https://{VCFA_HOST}/cloudapi/1.0.0/sessions/provider
```

It uses the returned bearer token for later VCF Automation, Service Broker, Cloud Assembly, and vRO API calls.

### VCF Cloud API Version Negotiation

VCF Automation 9.1 introduces API version `9.1.0` alongside `9.0.0`. Before authenticating, the server probes the unauthenticated discovery document at `https://{VCFA_HOST}/api/versions` and selects the newest API version it knows (`9.1.0` preferred, then `9.0.0`) for the session request. If the probe fails or advertises no known version, the server falls back to `9.0.0`, which 9.1 servers still accept. Set `VCFA_TARGET_PLATFORM` to `vcfa9.1` or `vcfa9.0` to pin the version explicitly and skip the probe.

For vRA/vRO 8.12+ read/run compatibility, set `VCFA_TARGET_PLATFORM=vra8`. vRA-embedded vRO rejects Basic auth on `/vco/api`, so in that mode the server skips the VCF Cloud API session endpoint and the `GET /api/versions` probe and instead runs the vRA 8 bearer-token flow: it posts `VCFA_USERNAME`, `VCFA_PASSWORD`, and `VCFA_ORGANIZATION` as the vIDM `domain` to `POST /csp/gateway/am/api/login?access_token`, exchanges the returned refresh token at `POST /iaas/api/login`, and sends the resulting token as `Authorization: Bearer` on every `/vco/api` request. A `401` from vRO — or a `403` that carries a `WWW-Authenticate` challenge — renews the token and retries the request once: the cached refresh token is exchanged again, and the full CSP login runs only if that token is rejected, so a renewal does not re-send the password. A `403` without a challenge is surfaced directly as an authorization result. Neither login request is allowed to follow a redirect, because the request body carries the credentials. VCFO-068 verified this mode against a vRA 8.18 lab (vRO 8.18.1). What it supports:

| Surface | vra8 mode |
| --- | --- |
| vRO `/vco/api` reads and writes | Supported — create/update/delete of workflows, actions, and configuration elements, multipart artifact imports, package build/export, workflow execution and logs |
| Automation-service reads (catalog items, deployments, templates, projects, subscriptions, event topics) | Supported — same page envelope and object shapes as VCFA 9.x, with no `apiVersion` pin required |
| Blueprint-service and event-broker writes (`create-template`, `delete-template`, subscription create/update/delete) | Supported — verified against a vRA 8.18 lab with a disposable DRAFT template and a disposable disabled subscription, neither of which provisions infrastructure |
| Catalog-service and deployment-service writes (`create-deployment`, `delete-deployment`, `run-deployment-action`) | Unsupported, pending verification — the verification lab had no released catalog content and no deployment to act on, and each path provisions or destroys real infrastructure |
| `export-configuration-file` | Unsupported — vRA 8 serves a configuration element as JSON only and answers the artifact request with `406`. Use `get-configuration`, or add it to the project package and export that. `prepare-artifact-promotion` reports a configuration backup as skipped for the same reason and still returns its report |
| `import-configuration-file` | Unverified but not guarded — the endpoint is reachable and the multipart transport is proven, but vRA 8 cannot export a `.vsoconf`, so no genuine container was round-tripped |

Subscription writes differ from the `vcfa` path in this mode: vRA 8 requires the client to choose the subscription id, answers the create `201` with an empty body, and serves neither `PUT` nor `PATCH` on `/subscriptions/{id}`. `create-subscription` therefore generates a UUID and re-reads the element, and `update-subscription` reads the live element, merges the caller's changes, and upserts the whole body with a `POST`; a partial upsert is rejected with `400` before anything is mutated. vRA 8 also serves system subscriptions with no name, which render as `(unnamed)`.

Two configuration request bodies also differ in this mode: configuration writes send the plural `attributes` key, because vRA 8 answers `400` for the singular `attribute` and for a body carrying both; and `PUT /configurations/{id}` must carry the element name. That `PUT` replaces the element on both platforms, so `update-configuration` reads the live element once and carries an omitted name and description forward (see the tools reference for the attribute rules). Catalog items and deployments were both empty in the verification lab, so those two endpoints and their page envelopes are verified but their item shapes are not.

## Optional Variables

| Variable | Description |
| --- | --- |
| `VCFA_TARGET_PLATFORM` | Target platform mode: `vcfa` (default, auto-negotiates the VCF Cloud API version), `vcfa9.1`/`vcfa9.0` (pin the VCF Cloud API version, skipping the `GET /api/versions` probe), or `vra8` (vRA/vRO 8.12+, vIDM bearer-token auth). |
| `VCFA_IGNORE_TLS` | Set to `true` to disable TLS certificate verification for this server's requests to the VCFA host (lab environments only). |
| `VCFA_ARTIFACT_DIR` | Root directory for local artifact import/export files. Defaults to `artifacts/` in the MCP server process working directory, typically the open project. |
| `VCFA_PACKAGE_DIR` | Override the package artifact directory. |
| `VCFA_RESOURCE_DIR` | Override the resource element artifact directory. |
| `VCFA_WORKFLOW_DIR` | Override the workflow artifact directory. |
| `VCFA_EXECUTION_LOG_DIR` | Override the workflow execution log export directory. |
| `VCFA_ACTION_DIR` | Override the action artifact directory. |
| `VCFA_CONFIGURATION_DIR` | Override the configuration artifact directory. |
| `VCFA_CONTEXT_DIR` | Override the persisted context snapshot directory. If unset, context snapshots prefer the MCP client's current workspace root at `artifacts/context/`, falling back to `VCFA_ARTIFACT_DIR/context`. |
| `VCFA_PROJECT_PACKAGE_NAME` | Stable fully-qualified package name reused by package-first workflows, for example `com.example.project`. |
| `VCFA_PROJECT_PACKAGE_DESCRIPTION` | Optional description used if the exact project package is explicitly created. |

## Artifact Directories

Artifacts are organized into typed subdirectories under `VCFA_ARTIFACT_DIR`:

```text
VCFA_ARTIFACT_DIR/
  actions/
  configurations/
  context/
  execution-logs/
  packages/
  resources/
  workflows/
```

Use the specific directory overrides only when you need different storage locations per artifact type.

## TLS Warning

`VCFA_IGNORE_TLS=true` disables TLS certificate verification only for this server's requests to the configured VCFA host, using a dedicated HTTPS agent. It does not set `NODE_TLS_REJECT_UNAUTHORIZED` or affect any other HTTPS traffic in the process. Use it only for lab or test environments where the risk is understood.
