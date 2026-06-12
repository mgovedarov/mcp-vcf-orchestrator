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

Set `VCFA_TARGET_PLATFORM=vra8` for vRA/vRO 8.12+ Basic-auth mode. This mode supports vRO `/vco/api` read operations, workflow execution, and execution logs. Catalog, deployment, template, subscription, and event-topic tools require Automation-service token auth and return an unsupported-mode message in this phase.

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
