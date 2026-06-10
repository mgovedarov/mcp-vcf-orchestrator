# Configuration

The server reads all runtime configuration from environment variables.

## Required Variables

| Variable | Required | Description |
| --- | --- | --- |
| `VCFA_HOST` | Yes | VCF Automation hostname, for example `vcfa.example.com`. |
| `VCFA_USERNAME` | Yes | Username without organization, for example `admin`. |
| `VCFA_ORGANIZATION` | Yes | Organization or tenant, for example `System` or `vsphere.local`. |
| `VCFA_PASSWORD` | Yes | Password for the VCF Cloud API session, or the vRO Basic-auth password when `VCFA_TARGET_PLATFORM=vra8`. |

The server authenticates by sending Basic Auth as `{VCFA_USERNAME}@{VCFA_ORGANIZATION}:{VCFA_PASSWORD}` to:

```text
https://{VCFA_HOST}/cloudapi/1.0.0/sessions
```

It uses the returned bearer token for later VCF Automation, Service Broker, Cloud Assembly, and vRO API calls.

For vRA/vRO 8.12+ read/run compatibility, set `VCFA_TARGET_PLATFORM=vra8`. In that mode, the server skips the VCF Cloud API session endpoint and sends Basic auth directly to `/vco/api`. The vRA/vRO 8 mode supports vRO read operations plus workflow execution and execution logs; Automation-service APIs such as catalog, deployments, templates, subscriptions, and event topics are intentionally unsupported until token-auth support is added.

## Optional Variables

| Variable | Description |
| --- | --- |
| `VCFA_TARGET_PLATFORM` | Target platform mode: `vcfa` (default) or `vra8`. |
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
