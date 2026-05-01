# Troubleshooting

## Missing Environment Variables

If the server exits with a missing variable error, set all required values:

```bash
VCFA_HOST=...
VCFA_USERNAME=...
VCFA_ORGANIZATION=...
VCFA_PASSWORD=...
```

## TLS Errors In Lab Environments

For lab systems with self-signed certificates, set:

```bash
VCFA_IGNORE_TLS=true
```

Use this only when you accept the TLS risk.

## Workflow Run Failures

Prefer `run-workflow-and-wait` during development. It validates input names and types against `get-workflow`, waits for completion, and returns failure context when available.

If a workflow was started asynchronously, use:

1. `list-workflow-executions`
2. `get-workflow-execution`
3. execution logs when available

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
