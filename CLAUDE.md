# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

- **Build**: `npm run build` – compiles TypeScript to `dist/` and produces the executable at `dist/index.js`.
- **Start**: `npm start` – runs the server with `tsx src/index.ts` (requires runtime environment variables).
- **Inspect**: `npm run inspect` – launches the MCP Inspector for debugging the server.
- **Validate**: `npm run validate` – builds, runs tests, enforces conservative coverage thresholds, checks docs/examples drift, builds docs, and validates npm package contents.
- **Docs/examples drift**: `npm run validate:docs` – checks registered tool, prompt, and resource names against reference docs, validates local Markdown links, and verifies documented tool-call examples use current top-level argument names.
- **Package contents**: `npm run validate:package` – runs `npm pack --dry-run --json` with an isolated temporary npm cache and verifies the published file set.
- **Environment**: The server reads VCFA_HOST, VCFA_USERNAME, VCFA_ORGANIZATION, VCFA_PASSWORD, and optionally VCFA_IGNORE_TLS, VCFA_ARTIFACT_DIR, VCFA_PACKAGE_DIR, VCFA_RESOURCE_DIR, VCFA_WORKFLOW_DIR, VCFA_ACTION_DIR, VCFA_CONFIGURATION_DIR, VCFA_CONTEXT_DIR, VCFA_PROJECT_PACKAGE_NAME, and VCFA_PROJECT_PACKAGE_DESCRIPTION from the environment (see `.env.example`).

## Architecture Overview

The repository implements an MCP server that exposes VCF Automation Orchestrator (vRO), Service Broker, and Cloud Assembly REST API operations. Core modules:

1. **src/index.ts** – Entry point that registers MCP tools, resources, prompts, and server instructions.
2. **src/vro-client.ts** – Compatibility export for the public `VroClient` import path.
3. **src/client/** – Modular VCF/vRO clients split by responsibility: shared HTTP/auth core, workflows, actions, configurations, categories, subscriptions, catalog, deployments, templates, packages, resources, and plugins.
4. **src/tools/** – Directory containing individual tool implementations (workflow, action, deployment, catalog-item, subscription, template, configuration, package, resource, plugin).
5. **src/resources/** and **src/prompts/** – MCP resource and prompt registrations that keep agents discovery-first.
6. **src/types.ts** – Shared TypeScript types and interfaces used across the server.
7. **dist/** – Compiled JavaScript output produced by `npm run build`.

Key architectural concepts:

- **MCP Server Model**: Tools are exposed as natural-language commands (`list-workflows`, `create-action`, `run-workflow`, etc.). Each tool maps to a specific MCP endpoint.
- **Plugin‑Style Extensibility**: Extensibility points (actions, blueprint templates, configuration elements) are organized by category and can be discovered via `list-*` commands.
- **Configuration Management**: Settings are stored as configuration elements within the platform; the server treats them as first‑class data objects.
- **Event‑Driven Subscriptions**: The server can subscribe to VMware event topics (e.g., `compute.allocation.pre`) and trigger ABX or VRO workflows.
- **Artifact Safety**: Local artifact tools keep files inside configured artifact directories; imports should be preceded by preflight, diff, optional backup, and explicit confirmation.
- **Workflow Authoring**: Use native vRO action workflow items for workflow steps that only invoke one existing action; use scriptable tasks for multiple action calls or additional orchestration logic. Prefer horizontal left-to-right workflow layouts.
- **Workflow Input Forms**: Workflows with user inputs need a valid `input_form_` for the vRO start page. Use UTF-16BE JSON with a BOM, page-level titles, section objects with only `id` and `fields`, matching field/schema IDs, and `options.externalValidations: []`.
- **Package Publishing**: Publish reusable vRO content through the project package path by default: ensure the exact project package, add discovered content, rebuild, export, inspect import details, and import the package.
- **Package Reuse**: Package-first workflows must reuse the exact project package from `VCFA_PROJECT_PACKAGE_NAME` or an explicit `packageName`; do not create random, timestamped, or task-specific packages.
- **Direct Imports**: Use direct workflow/action/configuration imports only for narrow validation or explicitly requested single-artifact tests; project content should move into vRO via packages.
- **Discovery Guardrails**: Prompts and docs should tell agents to discover required workflow/action/template/category/project facts instead of inventing environment-specific values.

## Key Files for Navigation

- `src/index.ts` – Main server bootstrap and tool registration.
- `src/vro-client.ts` – Stable compatibility shim exporting `VroClient`.
- `src/client/` – Client implementation modules; start with `src/client/index.ts` for the facade and `src/client/core.ts` for authentication/HTTP behavior.
- `src/tools/` – Individual tool implementations; filenames correspond to tool names.
- `src/resources/index.ts` and `src/prompts/index.ts` – MCP resources and agent prompt playbooks.
- `scripts/validate-docs.mjs` and `scripts/validate-package.mjs` – Validation checks for docs/examples drift and package contents.
- `package.json` – Scripts and dependencies; useful for understanding build and runtime commands.

## Development Workflow

1. Make code changes.
2. Run `npm run validate` before handing off broad changes.
3. Use `npm start` to run the server locally (ensure environment variables are set).
4. For debugging, launch `npm run inspect` to open the MCP Inspector in a browser.

Automated tests use Node's built-in test runner. Run `npm test` to build and execute `test/*.test.mjs`.

Live VCFA validation should stay separate from local validation. Read-only list/get smoke checks are acceptable against a sandbox environment; imports, deletes, deployment day-2 actions, and other writes require explicit user confirmation and disposable test assets.
