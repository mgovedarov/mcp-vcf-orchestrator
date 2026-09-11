# Troubleshooting

## Missing Environment Variables

If the server exits with a missing variable error, set all required values:

```bash
VCFA_HOST=...
VCFA_USERNAME=...
VCFA_ORGANIZATION=...
VCFA_PASSWORD=...
```

## 401 Unauthorized At Login

The session request sends Basic auth as `{VCFA_USERNAME}@{VCFA_ORGANIZATION}`. If credentials are correct but the login still returns 401:

- `VCFA_ORGANIZATION` must be the organization **name** (the tenant URL slug, for example the `<orgName>` in `https://<host>/tenant/<orgName>`), not its display name.
- Provider/system administrator accounts must set `VCFA_ORGANIZATION=system`. That routes the login to `/cloudapi/1.0.0/sessions/provider`; the tenant `/sessions` endpoint rejects provider accounts with 401 regardless of password.
- The server auto-negotiates the VCF Cloud API version (`9.1.0` on VCF Automation 9.1, `9.0.0` otherwise) via `GET /api/versions`. If negotiation misbehaves against an unusual target, pin it with `VCFA_TARGET_PLATFORM=vcfa9.1` or `vcfa9.0`.

For `VCFA_TARGET_PLATFORM=vra8` the login is the vRA 8 bearer-token flow, a vIDM CSP login followed by a refresh-token exchange at `/iaas/api/login`, rather than the Cloud API session. If it fails:

- A `400` or `401` from `/csp/gateway/am/api/login` means the vIDM credentials or domain are wrong. `VCFA_USERNAME` and `VCFA_PASSWORD` are the Workspace ONE Access credentials, and `VCFA_ORGANIZATION` must be the domain shown on that login page, for example `System Domain` for local users. A VCF organization name or `system` is rejected there.
- The domain must reach the server as the exact string, spaces included. In an MCP client's JSON `env` block that is simply `"VCFA_ORGANIZATION": "System Domain"` — quotes written inside the value become part of it and the CSP login rejects them with `400`. On a command line the value needs shell quoting (`VCFA_ORGANIZATION="System Domain"`), or the shell treats the word after the space as the command. Surrounding whitespace is trimmed before the login.
- A `401` from `/vco/api` after a successful login is treated as an expired token: the server renews it (exchanging the cached refresh token, or repeating the CSP login if that is rejected) and retries once before surfacing the error.
- A `403` from `/vco/api` is not a login problem. Unless it carries a `WWW-Authenticate` challenge, it is reported directly as an authorization result: the vIDM user has no permission for that vRO object or operation.
- A redirect on either login endpoint is reported as a login failure naming the host it points at, and is deliberately not followed — the request body carries the credentials. Point `VCFA_HOST` at the appliance's API endpoint rather than at an SSO portal or a redirecting load balancer.

## TLS Errors In Lab Environments

For lab systems with self-signed certificates, set:

```bash
VCFA_IGNORE_TLS=true
```

Use this only when you accept the TLS risk.

## Workflow Run Failures

Prefer `run-workflow-and-wait` with `confirm: true` during development after the target workflow and inputs are verified. It validates input names and types against `get-workflow`, waits for completion, and returns failure context when available.

If a workflow was started asynchronously, use:

1. `list-workflow-executions`
2. `get-workflow-execution`
3. `get-workflow-execution-logs`

`get-workflow-execution-logs` reads the execution `syslogs` stream, which is where vRO exposes workflow token messages such as `System.log`, `System.debug`, `System.warn`, and `System.error`. Use `level: "error"` to show only error entries, or provide `fileName` to export the filtered logs as `.json` or `.txt`.

## vRA/vRO 8 Mode

Set `VCFA_TARGET_PLATFORM=vra8` for vRA/vRO 8.12+. The server authenticates with the vRA 8 bearer-token flow described above and supports the full vRO `/vco/api` surface plus the read paths of the catalog, deployment, template, project, subscription, and event-topic tools. Template and subscription writes are supported here (verified under VCFO-070). Two things still return an unsupported-mode message in this mode:

- Catalog-service and deployment-service **writes** — `create-deployment`, `delete-deployment`, and `run-deployment-action` — pending lab verification (VCFO-070). The refusal names what verifying that service would take: released catalog content for the request path, and an existing deployment for the delete and day-2 paths.
- `export-configuration-file`, because vRA 8 serves a configuration element as JSON only and rejects the artifact request with `406`. Read it with `get-configuration`, or add it to the project package with `add-configuration-to-project-package` and run `export-project-package`. `prepare-artifact-promotion` with `backup.enabled` for a configuration artifact reports `Backup skipped:` with the same pointer and still returns the preflight report and import recommendation.

A `400` in this mode used to arrive with no usable detail: the vRA 8 gateway answers a rejected `/vco/api` request with a styled HTML page whose only diagnostic content is the status code and reason, buried past a stylesheet, and these responses arrive over HTTP/2, which carries no reason phrase. Such a body is now summarized as `[HTML body: 400 Bad Request — no further detail]` instead of an excerpt of CSS, and every error message fills in the standard reason phrase when the response carries none, so the status line reads `400 Bad Request` rather than a bare `400`.

## Artifact Import Failures

Run the matching preflight tool first. Common issues include:

- malformed ZIP archive
- missing `workflow-info` or `workflow-content`
- wrong workflow-content encoding
- bad parameter or binding references
- unsafe file name or path
- package contents that include malformed nested artifacts

## Catalog Or Template Ambiguity

Catalog items, templates, and deployments can be project-scoped. If a search returns no match or several plausible matches, inspect with `get-catalog-item`, `get-template`, or `get-deployment` before creating or updating anything.

## GitHub Pages

After merging the docs workflow, set repository Pages source to **GitHub Actions** in GitHub repository settings. The workflow publishes the VitePress build output from `docs/.vitepress/dist`.
