# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

- **Build**: `npm run build` – runs `tsc`, compiling TypeScript to `dist/` (executable entry at `dist/index.js`).
- **Start**: `npm start` – runs the server with `tsx src/index.ts` (requires runtime environment variables; speaks MCP over stdio).
- **Test**: `npm test` – builds, then runs `node --test test/*.test.mjs`. Run a single file with `npm run build && node --test test/workflow-tools.test.mjs`. Filter within a file with `node --test --test-name-pattern="<regex>" test/<file>.test.mjs`.
- **Coverage gate**: `npm run test:coverage:check` – enforces lines ≥80, branches ≥70, functions ≥80.
- **Inspect**: `npm run inspect` – launches the MCP Inspector against the built server for interactive debugging.
- **Validate**: `npm run validate` – the full local gate: build, tests, coverage thresholds, docs/examples drift, VitePress docs build, and npm package-content checks. Must not contact a live VCFA environment.
- **Docs/examples drift**: `npm run validate:docs` – checks registered tool/prompt/resource names against reference docs, validates local Markdown links, and verifies documented tool-call examples use current top-level argument names.
- **Package contents**: `npm run validate:package` – runs `npm pack --dry-run --json` with an isolated temp npm cache and verifies the published file set.
- **Docs**: `npm run docs:dev` (local preview server), `npm run docs:build`, `npm run docs:preview`.

## Environment Configuration

Required at startup (the process exits if any is missing): `VCFA_HOST`, `VCFA_USERNAME`, `VCFA_ORGANIZATION`, `VCFA_PASSWORD`.

Notable optional variables (see `.env.example` and `README.md` for the full table):

- `VCFA_TARGET_PLATFORM` – `vcfa` (default, VCF Cloud API session flow) or `vra8` (vRA/vRO 8.12+ Basic-auth against `/vco/api`). `vra8` supports only vRO read operations plus workflow execution/logs; Automation-service APIs (catalog, deployments, templates, subscriptions, event topics) are intentionally unsupported in that mode.
- `VCFA_IGNORE_TLS` – `true` skips TLS verification for the client's VCFA requests only (lab use only).
- Artifact directories: `VCFA_ARTIFACT_DIR` (root, defaults to `artifacts/` under the process cwd) and per-kind overrides `VCFA_WORKFLOW_DIR`, `VCFA_ACTION_DIR`, `VCFA_CONFIGURATION_DIR`, `VCFA_RESOURCE_DIR`, `VCFA_PACKAGE_DIR`, `VCFA_EXECUTION_LOG_DIR`, `VCFA_CONTEXT_DIR`.
- Package-first publishing: `VCFA_PROJECT_PACKAGE_NAME` (stable fully-qualified package, e.g. `com.example.project`) and `VCFA_PROJECT_PACKAGE_DESCRIPTION`.

## Architecture Overview

The repository implements an MCP server that exposes VCF Automation Orchestrator (vRO), Service Broker, and Cloud Assembly REST API operations to AI assistants. The big-picture flow: `src/index.ts` reads env config, constructs a `VroClient`, then calls each `register*Tools`/`registerVcfa{Resources,Prompts}` function to attach capabilities onto a single `McpServer` served over stdio.

The codebase has three layers; understanding the seam between them is the fastest way to be productive:

1. **Client layer (`src/client/`)** – Modular VCF/vRO clients split by responsibility. `core.ts` owns auth, HTTP, and bearer-token refresh; `index.ts` composes the per-domain clients (workflow, action, configuration, category, subscription, catalog, deployment, template, package, resource, plugin) into the facade. Cross-cutting helpers live alongside them: `pagination.ts`, `parameters.ts`, `attrs.ts`, `files.ts` (artifact path safety), `artifact-preflight.ts`, `workflow-artifact.ts`, and `context-snapshot.ts`. `src/vro-client.ts` is a stable compatibility shim re-exporting `VroClient` for the public import path.
2. **Tool layer (`src/tools/`)** – Each file registers a group of MCP tools and maps natural-language tool names onto client calls. `confirmation-guards.ts` is shared infrastructure that enforces the `confirm: true` requirement on mutating tools; `promotion-tools.ts` and `context-tools.ts` implement the artifact-promotion and context-snapshot surfaces.
3. **Discovery layer (`src/resources/index.ts`, `src/prompts/index.ts`)** – MCP resources (`vcfa://...` URIs for docs, patterns, and live objects) and prompt playbooks (`vcfa-*`) that steer agents toward discovery-first, safe workflows.

`src/types.ts` holds shared types; `src/context-directory.ts` resolves where context snapshots are written.

Key architectural concepts:

- **Discovery-first, conservative writes**: Read-only `list-*`/`get-*` tools come first. Mutating tools (create/update/import/delete, deployment day-2 actions, package import, local overwrite) require an explicit `confirm: true` argument enforced via `confirmation-guards.ts` — and that schema flag is in addition to, not a substitute for, real user confirmation of target and impact.
- **Artifact lifecycle**: For workflow/action/configuration/resource/package work, follow discover → export/snapshot → author locally → preflight → diff → `prepare-artifact-promotion` → confirm → import → verify. Local artifact tools keep files inside the configured directories and reject paths, absolute paths, traversal, and symlinks; file arguments are plain file names under the matching directory.
- **Package-first publishing**: Reusable project content moves through the stable project package (`VCFA_PROJECT_PACKAGE_NAME` or explicit `packageName`): `ensure-project-package` → `add-*-to-project-package` → `rebuild-project-package` → `export-project-package` → `get-project-package-import-details` → `import-project-package`. Do not create random, timestamped, or task-specific packages. Use direct `import-*-file` tools only for narrow validation or explicitly requested one-off tests.
- **Workflow authoring**: Prefer native vRO action workflow items when a step invokes a single existing action; use scriptable tasks for multiple action calls or extra orchestration. Prefer horizontal left-to-right layouts. Workflows with inputs need a valid `input_form_` (UTF-16BE JSON with BOM, page-level titles, section objects with only `id` and `fields`, field IDs matching `schema` keys, `options.externalValidations: []`). Native action items export as `type="task"` with `script-module="<module>/<actionName>"` and must keep the generated script assigning the result to `actionResult`. See `docs/vro-artifact-authoring.md`.
- **Event-driven subscriptions**: The server can subscribe to VMware event topics (e.g. `compute.allocation.pre`) and trigger ABX or vRO workflows.
- **Docs/source sync**: Registered tool, prompt, and resource names plus documented examples are validated against the docs; adding or renaming any of them requires updating `docs/reference/*` and `examples/README.md`, caught by `npm run validate:docs`.

## Conventions

- **`AGENTS.md` is the deeper operating playbook.** It documents the full current tool/prompt/resource surface, artifact-lifecycle steps, package-first rules, workflow authoring rules, and template/subscription/catalog/deployment rules. Read it before non-trivial behavior changes; this file is the orientation, `AGENTS.md` is the detail.
- **Do not invent environment-specific values** (vRO IDs, schemas, parameters, action contracts, package/project/category IDs, blueprint YAML). Verify from source, docs, or configured MCP tools, and report a missing fact rather than filling the gap.
- **Adding a tool**: update the relevant `src/tools/*` module, set accurate read-only/destructive annotations, add tests, and update `docs/reference/tools.md` plus relevant how-tos. For prompts/resources, update `src/prompts/index.ts` or `src/resources/index.ts` and `docs/reference/resources-prompts.md`. For docs sidebar entries, update `docs/.vitepress/config.ts`.
- **Issue codes**: use `VCFO-###` (sequential, prefixed in issue titles, e.g. `[VCFO-001] ...`).

## Testing & Validation

Automated tests use Node's built-in test runner over `test/*.test.mjs` (each test builds first). Use the smallest meaningful check for a change and the full `npm run validate` gate before broad, docs, or release-facing changes.

Live VCFA validation stays separate from local validation. Read-only list/get smoke checks are acceptable against a sandbox environment; imports, deletes, deployment day-2 actions, template creation, subscription changes, and package imports require explicit user confirmation and disposable test assets.
