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
| `VCFA_PASSWORD` | Password for the VCF Cloud API session. |

Useful optional variables:

| Variable | Description |
| --- | --- |
| `VCFA_IGNORE_TLS` | Set to `true` to skip TLS certificate verification in lab environments. |
| `VCFA_ARTIFACT_DIR` | Root directory for local artifact files. Defaults to `artifacts/` in the MCP server process working directory, typically the open project. |
| `VCFA_PACKAGE_DIR` | Override package artifact directory. |
| `VCFA_RESOURCE_DIR` | Override resource artifact directory. |
| `VCFA_WORKFLOW_DIR` | Override workflow artifact directory. |
| `VCFA_ACTION_DIR` | Override action artifact directory. |
| `VCFA_CONFIGURATION_DIR` | Override configuration artifact directory. |
| `VCFA_CONTEXT_DIR` | Override persisted context snapshot directory. If unset, context snapshots prefer the MCP client's current workspace root at `artifacts/context/`, falling back to `VCFA_ARTIFACT_DIR/context`. |

## Tool Coverage

The server includes tools for:

- Workflows, workflow executions, workflow artifact scaffold/preflight/diff/import/export
- Actions and action artifact import/export/preflight/diff
- Configuration elements and resource elements
- vRO packages and plugins
- Categories
- Service Broker catalog items and deployments
- Deployment day-2 actions
- Cloud Assembly blueprint templates
- Event topics and extensibility subscriptions
- Artifact promotion planning
- Persisted Markdown/JSON context snapshots for future agents
- MCP resources and prompts for discovery-first implementation work

See the [tool reference](docs/reference/tools.md) for the full list.

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

## Development

```bash
# Type-check and build
npm run build

# Run tests
npm test

# Run in dev mode
VCFA_HOST=... VCFA_USERNAME=... VCFA_ORGANIZATION=... VCFA_PASSWORD=... npm start

# Build documentation
npm run docs:build

# Preview documentation locally
npm run docs:dev
```

## Safety

Use read-only discovery tools before live writes. Import, delete, deployment action, and overwrite operations require explicit confirmation. Local artifact tools only read or write under configured artifact directories and reject unsafe paths.
