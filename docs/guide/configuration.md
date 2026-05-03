# Configuration

The server reads all runtime configuration from environment variables.

## Required Variables

| Variable | Required | Description |
| --- | --- | --- |
| `VCFA_HOST` | Yes | VCF Automation hostname, for example `vcfa.example.com`. |
| `VCFA_USERNAME` | Yes | Username without organization, for example `admin`. |
| `VCFA_ORGANIZATION` | Yes | Organization or tenant, for example `System` or `vsphere.local`. |
| `VCFA_PASSWORD` | Yes | Password for the VCF Cloud API session. |

The server authenticates by sending Basic Auth as `{VCFA_USERNAME}@{VCFA_ORGANIZATION}:{VCFA_PASSWORD}` to:

```text
https://{VCFA_HOST}/cloudapi/1.0.0/sessions
```

It uses the returned bearer token for later VCF Automation, Service Broker, Cloud Assembly, and vRO API calls.

## Optional Variables

| Variable | Description |
| --- | --- |
| `VCFA_IGNORE_TLS` | Set to `true` to disable TLS certificate verification for lab environments. |
| `VCFA_ARTIFACT_DIR` | Root directory for local artifact import/export files. Defaults to `artifacts/` in the repository root. |
| `VCFA_PACKAGE_DIR` | Override the package artifact directory. |
| `VCFA_RESOURCE_DIR` | Override the resource element artifact directory. |
| `VCFA_WORKFLOW_DIR` | Override the workflow artifact directory. |
| `VCFA_ACTION_DIR` | Override the action artifact directory. |
| `VCFA_CONFIGURATION_DIR` | Override the configuration artifact directory. |
| `VCFA_CONTEXT_DIR` | Override the persisted context snapshot directory. |

## Artifact Directories

Artifacts are organized into typed subdirectories under `VCFA_ARTIFACT_DIR`:

```text
VCFA_ARTIFACT_DIR/
  actions/
  configurations/
  context/
  packages/
  resources/
  workflows/
```

Use the specific directory overrides only when you need different storage locations per artifact type.

## TLS Warning

`VCFA_IGNORE_TLS=true` sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for the process. Use it only for lab or test environments where the risk is understood.
