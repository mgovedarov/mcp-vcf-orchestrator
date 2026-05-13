# MCP Server for VCF Automation Orchestrator

[![npm version](https://img.shields.io/npm/v/@mgovedarov/mcp-vcf-orchestrator)](https://www.npmjs.com/package/@mgovedarov/mcp-vcf-orchestrator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An [MCP](https://modelcontextprotocol.io/) server that exposes VCF Automation Orchestrator (vRO), Service Broker, and Cloud Assembly REST API operations as tools. It helps AI assistants list, inspect, run, create, export, preflight, diff, import, and delete VCFA/vRO automation assets through discovery-first workflows.

Supports **VCF 9 Automation** and **Aria Automation 8.x**.

## Documentation

Full documentation is available in the GitHub Pages site:

- Published site: <https://mgovedarov.github.io/mcp-vcf-orchestrator/>
- Local docs entry point: [docs/index.md](docs/index.md)
- vRO artifact authoring notes: [docs/vro-artifact-authoring.md](docs/vro-artifact-authoring.md)

The docs include installation, configuration, MCP client setup, tool references, resources/prompts, how-tos, artifact lifecycle guidance, safety notes, troubleshooting, and contributor guidance.

Checked examples for common workflows are available in [examples/README.md](examples/README.md). These examples are validated against the registered tool and prompt names so stale snippets are caught during development.

## Quick Start

Run directly from npm:

```bash
npx @mgovedarov/mcp-vcf-orchestrator
```

Or install globally:

```bash
npm install -g @mgovedarov/mcp-vcf-orchestrator
mcp-vcf-orchestrator
```

Run from source:

```bash
git clone https://github.com/mgovedarov/mcp-vcf-orchestrator.git
cd mcp-vcf-orchestrator
npm install
npm run build
```

## Configuration

Required environment variables:

| Variable | Description |
| --- | --- |
| `VCFA_HOST` | VCF Automation hostname, for example `vcfa.example.com`. |
| `VCFA_USERNAME` | Username without organization, for example `admin`. |
| `VCFA_ORGANIZATION` | Organization or tenant, for example `System` or `vsphere.local`. |
| `VCFA_PASSWORD` | Password for the VCF Cloud API session, or the vRO Basic-auth password when `VCFA_TARGET_PLATFORM=vra8`. |

Useful optional variables:

| Variable | Description |
| --- | --- |
| `VCFA_TARGET_PLATFORM` | Target platform mode. Defaults to `vcfa`, which uses the VCF Cloud API session flow. Set to `vra8` for vRA/vRO 8.12+ Basic-auth mode against `/vco/api`; this mode supports vRO read operations plus workflow execution/logs and does not support Automation-service APIs such as catalog, deployments, templates, or subscriptions. |
| `VCFA_IGNORE_TLS` | Set to `true` to skip TLS certificate verification in lab environments. |
| `VCFA_ARTIFACT_DIR` | Root directory for local artifact files. Defaults to `artifacts/` in the MCP server process working directory, typically the open project. |
| `VCFA_PACKAGE_DIR` | Override package artifact directory. |
| `VCFA_RESOURCE_DIR` | Override resource artifact directory. |
| `VCFA_WORKFLOW_DIR` | Override workflow artifact directory. |
| `VCFA_EXECUTION_LOG_DIR` | Override workflow execution log export directory. |
| `VCFA_ACTION_DIR` | Override action artifact directory. |
| `VCFA_CONFIGURATION_DIR` | Override configuration artifact directory. |
| `VCFA_CONTEXT_DIR` | Override persisted context snapshot directory. If unset, context snapshots prefer the MCP client's current workspace root at `artifacts/context/`, falling back to `VCFA_ARTIFACT_DIR/context`. |
| `VCFA_PROJECT_PACKAGE_NAME` | Stable fully-qualified vRO package name reused by package-first project workflows, for example `com.example.project`. |
| `VCFA_PROJECT_PACKAGE_DESCRIPTION` | Optional description used only when the exact project package is explicitly created. |

## Tool Coverage

The server includes tools for:

- Workflows, recursive workflow category/folder listing, workflow executions, inline/exported execution syslogs, workflow artifact scaffold/preflight/diff/import/export
- Actions and action artifact import/export/preflight/diff
- Configuration elements and resource elements
- vRO packages and plugins, including package-first project package reuse
- Categories
- Service Broker catalog items and deployments
- Deployment day-2 actions
- Cloud Assembly blueprint templates
- Event topics and extensibility subscriptions
- Artifact promotion planning
- Persisted Markdown/JSON context snapshots for future agents
- MCP resources and prompts for discovery-first implementation work

See the [tool reference](docs/reference/tools.md) for the full list.

The source and reference docs are kept in sync by `npm run validate:docs`, which compares registered tools, prompts, and resources against the documentation and checks documented examples for stale tool names or top-level arguments.

## Prompt Examples

Discover what is reusable before building:

```text
Use prompt vcfa-discover-capabilities with:
goal: "Map reusable VM provisioning workflows, actions, templates, catalog items, and subscriptions."
```

Persist environment context for future agents:

```text
Use prompt vcfa-collect-context-snapshot with:
goal: "Persist reusable VM provisioning context before implementation work."
includeOptionalDomains: true
```

Persist VMware built-in workflow and action baseline context:

```text
Use prompt vcfa-collect-context-snapshot with:
goal: "Persist VMware built-in workflow and action baseline context."
profile: vcfaBuiltIns
```

Author a real importable workflow artifact:

```text
Use prompt vcfa-author-workflow with:
goal: "Build a workflow that accepts a project name and returns matching VM names."
categoryHint: "VCFA"
```

Wrap an existing vRO action as a workflow:

```text
Use prompt vcfa-build-workflow-from-action with:
actionHint: "getAllMachines"
workflowGoal: "Expose machine inventory lookup as a workflow."
categoryHint: "VCFA"
```

## Common Tool Examples

Collect a broader environment snapshot when the default item limit may skip relevant objects:

```text
collect-context-snapshot(fileBaseName: "vcfa-context-full", includeOptionalDomains: true, maxItemsPerDomain: 600, overwrite: true)
```

Plan an implementation from verified discovery before authoring artifacts:

```text
Use prompt vcfa-discovery-first-implementation-plan with:
goal: "Create a workflow that lists VMs by project name."
artifactKinds: "workflows and actions"
```

Prepare a safe workflow replacement with preflight, diff, and a live backup before importing:

```text
prepare-artifact-promotion(kind: "workflow", fileName: "echo-message.workflow", target: {
  categoryId: "<workflow-category-id>",
  workflowId: "<live-workflow-id>"
}, backup: {
  enabled: true,
  fileName: "echo-message-backup.workflow",
  overwrite: false
}, overwrite: true)
```

Run a workflow with input validation, then export execution logs for troubleshooting:

```text
get-workflow(id: "<workflow-id>")
run-workflow-and-wait(id: "<workflow-id>", inputs: [{ name: "message", value: "hello" }], timeoutSeconds: 60, pollIntervalSeconds: 2, confirm: true)
list-workflow-executions(workflowId: "<workflow-id>", maxResults: 5)
get-workflow-execution-logs(workflowId: "<workflow-id>", executionId: "<execution-id>", fileName: "execution-logs.json", level: "info", format: "json", maxResult: 200, overwrite: true)
```

Publish reusable project content through the stable project package:

```text
ensure-project-package(packageName: "com.example.project")
add-workflow-to-project-package(packageName: "com.example.project", workflowId: "<workflow-id>", confirm: true)
rebuild-project-package(packageName: "com.example.project", confirm: true)
export-project-package(packageName: "com.example.project", fileName: "com.example.project.package", overwrite: true)
get-project-package-import-details(packageName: "com.example.project", fileName: "com.example.project.package")
```

## Development

```bash
# Type-check and build
npm run build

# Run tests
npm test

# Run the full local validation gate
npm run validate

# Check docs/examples drift only
npm run validate:docs

# Run in dev mode
VCFA_HOST=... VCFA_USERNAME=... VCFA_ORGANIZATION=... VCFA_PASSWORD=... npm start

# Build documentation
npm run docs:build

# Preview documentation locally
npm run docs:dev
```

`npm run validate` builds the project, runs unit tests, enforces conservative coverage thresholds, validates docs/examples drift, builds the VitePress docs, and dry-runs npm packaging with package-content checks.

## Safety

Use read-only discovery tools before live writes. Import, delete, deployment action, and overwrite operations require explicit confirmation. Local artifact tools only read or write under configured artifact directories and reject unsafe paths.

Live VCFA validation should be run separately from local validation. Read-only list/get smoke checks are appropriate for sandbox environments; write, import, delete, and day-2 action tests should use disposable assets and explicit confirmation.
