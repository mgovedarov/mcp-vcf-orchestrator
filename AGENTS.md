---
name: VCF Orchestrator Agent
description: Practical operating instructions for AI agents working on the VCF Automation Orchestrator MCP server
trigger: "vcfa-orchestrator"
---

# VCF Orchestrator Agent

This repository builds an MCP server for VCF Automation Orchestrator (vRO), Service Broker, and Cloud Assembly. It also supports a vRA/vRO 8.12+ read/run mode through `VCFA_TARGET_PLATFORM=vra8`. Agents working here should be discovery-first, conservative with live environments, and biased toward real importable artifacts over illustrative pseudocode.

Use these instructions for all work in this repository. If a more specific `AGENTS.md` exists in a subdirectory, apply that file for its subtree and keep compatible guidance from this file. When instructions conflict, the deeper file wins for files in its scope.

## First Principles

- Read existing code and docs before planning or editing. Prefer repo-specific guidance over generic MCP, VCFA, vRO, or TypeScript advice.
- Preserve existing patterns. Add abstractions only when they reduce real duplication or match an established local pattern.
- Do not invent VCF Automation/vRO IDs, schemas, workflow parameters, action contracts, package names, project IDs, category IDs, blueprint YAML, or MCP tool behavior. Verify from docs, source, or configured MCP tools.
- Treat live VCFA/vRO writes as environment changes. Use read-only discovery first and ask for explicit confirmation before create, update, import, delete, deployment day-2, template, subscription, deployment, package, or local overwrite operations.
- Keep local artifact work inside configured artifact directories. Do not bypass path safety with absolute paths, traversal, symlinks, or ad hoc filesystem writes.
- Prefer deterministic, reviewable workflows: discover, export or snapshot, author locally, preflight, diff, prepare promotion, confirm, import, verify.

## Source Of Truth

Read the relevant source or docs before changing behavior:

- Tool registration: `src/tools/*`
- Client behavior: `src/client/*` and `src/vro-client.ts`
- MCP resources: `src/resources/index.ts`
- MCP prompts: `src/prompts/index.ts`
- Tool reference: `docs/reference/tools.md`
- Resources and prompts reference: `docs/reference/resources-prompts.md`
- Artifact lifecycle: `docs/artifacts/lifecycle.md`
- Workflow authoring: `docs/artifacts/workflow-authoring.md`
- Full vRO artifact notes: `docs/vro-artifact-authoring.md`
- Safety guidance: `docs/operations/safety.md`
- Development and docs process: `docs/operations/contributing.md`
- Checked examples: `examples/README.md`
- Claude Code plugin and skills: `.claude-plugin/` and `skills/<name>/SKILL.md`

The Claude Code skills must stay thin: they delegate to the `vcfa-*` prompts, `vcfa://` resources, and tools and must not re-document them. Tool/prompt/resource names referenced in a `SKILL.md` are drift-checked by `npm run validate:docs`; add any legitimate new non-tool kebab term to `KNOWN_NON_REGISTRY_TERMS` in `scripts/validate-docs.mjs`.

If the docs and source disagree, inspect the source, update the docs or examples, and run the docs validation gate.

## Current MCP Tool Surface

Use the exact registered tool names. Start with list/get tools unless the user has already provided verified IDs and contracts.

- Context and promotion: `collect-context-snapshot`, `prepare-artifact-promotion`
- Workflows: `list-workflows`, `list-workflows-by-category`, `get-workflow`, `create-workflow`, `run-workflow`, `run-workflow-and-wait`, `list-workflow-executions`, `get-workflow-execution`, `get-workflow-execution-logs`, `export-workflow-file`, `scaffold-workflow-file`, `preflight-workflow-file`, `diff-workflow-file`, `import-workflow-file`, `delete-workflow`
- Actions: `list-actions`, `get-action`, `create-action`, `export-action-file`, `preflight-action-file`, `diff-action-file`, `import-action-file`, `delete-action`
- Configuration elements: `list-configurations`, `get-configuration`, `create-configuration`, `update-configuration`, `export-configuration-file`, `preflight-configuration-file`, `import-configuration-file`, `delete-configuration`
- Resource elements: `list-resource-elements`, `export-resource-element`, `import-resource-element`, `update-resource-element`, `delete-resource-element`
- Packages: `list-packages`, `get-package`, `create-package`, `ensure-project-package`, `add-workflow-to-project-package`, `add-action-to-project-package`, `add-configuration-to-project-package`, `add-resource-to-project-package`, `rebuild-project-package`, `export-package`, `export-project-package`, `preflight-package`, `get-package-import-details`, `get-project-package-import-details`, `import-package`, `import-project-package`, `delete-package`
- Categories and plugins: `list-categories`, `list-plugins`
- Templates: `list-templates`, `get-template`, `create-template`, `delete-template`
- Subscriptions and event topics: `list-event-topics`, `list-subscriptions`, `get-subscription`, `create-subscription`, `update-subscription`, `delete-subscription`
- Catalog and deployments: `list-catalog-items`, `get-catalog-item`, `list-deployments`, `get-deployment`, `create-deployment`, `delete-deployment`, `list-deployment-actions`, `run-deployment-action`

Many write-capable tools require a `confirm: true` argument before they mutate state. That schema requirement does not replace user confirmation. Confirm the exact target, expected impact, and rollback or backup plan before calling live create, update, import, delete, deployment, day-2, package, or local overwrite tools.

In `vra8` mode, support only vRO `/vco/api` read operations plus workflow execution and execution logs. Automation-service APIs such as catalog, deployments, templates, subscriptions, and event topics are intentionally unsupported in Basic-auth mode until token-auth support is added.

On the default `vcfa` platform, the client auto-negotiates the VCF Cloud API version (`9.1.0` preferred, then `9.0.0`) via the unauthenticated `GET /api/versions` discovery document; `VCFA_TARGET_PLATFORM=vcfa9.1` or `vcfa9.0` pins it. Logins with `VCFA_ORGANIZATION=system` (case-insensitive) are routed to `/cloudapi/1.0.0/sessions/provider` for provider/system administrators; tenant logins use `/cloudapi/1.0.0/sessions` with the organization name (URL slug), not its display name.

## Current MCP Prompts And Resources

Prefer server-provided prompts for larger VCFA/vRO tasks because they encode the repository's discovery and safety playbooks.

Prompts:

- `vcfa-discover-capabilities`: explore reusable plugins, categories, workflows, actions, catalog items, deployments, templates, subscriptions, and gaps.
- `vcfa-collect-context-snapshot`: persist reusable Markdown and JSON environment context.
- `vcfa-discovery-first-implementation-plan`: produce a phased plan that starts with verified read-only discovery.
- `vcfa-author-workflow`: plan, scaffold, preflight, and safely promote workflow artifacts.
- `vcfa-build-workflow-from-action`: discover an existing action and build a workflow wrapper from its verified contract.
- `vcfa-refactor-workflow`: inspect, export, diff, and plan safe workflow refactors.
- `vcfa-review-artifact-import`: review local workflow, action, configuration, or package artifacts before import.
- `vcfa-create-template`: discover existing Cloud Assembly template conventions before drafting a template.
- `vcfa-review-template`: inspect an existing blueprint template for correctness, reuse, and catalog readiness.
- `vcfa-integrate-workflow-template-subscription`: plan workflow, template, catalog, deployment, and extensibility subscription integration.
- `vcfa-troubleshoot-deployment`: inspect deployment state and day-2 options before remediation.
- `vcfa-troubleshoot-workflow-execution`: diagnose a failed or problematic workflow execution using logs, stack, and workflow source.

Resources:

- `vcfa://docs/readme`
- `vcfa://docs/artifact-authoring`
- `vcfa://schemas/workflow-scaffold`
- `vcfa://patterns/workflows/basic-scriptable-task`
- `vcfa://patterns/workflows/action-wrapper`
- `vcfa://patterns/templates/conventions`
- `vcfa://patterns/templates/small-vm`
- `vcfa://patterns/templates/catalog-ready`
- `vcfa://context/latest`
- `vcfa://context/snapshots/{fileName}`
- `vcfa://workflows/{id}`
- `vcfa://actions/{id}`
- `vcfa://deployments/{id}`
- `vcfa://configurations/{id}`
- `vcfa://resource-elements/{id}`
- `vcfa://subscriptions/{id}`
- `vcfa://packages/{name}`
- `vcfa://patterns/subscriptions/event-driven`

Use `collect-context-snapshot` in unfamiliar or large environments. Use `profile: "vcfaBuiltIns"` when the task needs a VMware built-in baseline from Library workflows and `com.vmware` actions. Increase `maxItemsPerDomain` when the default limit would skip relevant objects.

## Artifact Lifecycle

For workflow, action, configuration, resource, and package work, follow this sequence unless the user explicitly requests a narrower read-only review:

1. Discover the live target and dependencies with list/get tools.
2. Export or snapshot existing live state when replacing or refactoring content.
3. Author or modify the local artifact under the configured artifact directory.
4. Run the matching preflight tool.
5. Run a diff when replacing workflow or action artifacts.
6. Use `prepare-artifact-promotion` when replacing live workflow, action, configuration, or package artifacts.
7. Confirm the exact target and impact with the user.
8. Import or publish.
9. Verify with read-only inspection or a confirmed execution.

Configured artifact directories:

- `VCFA_ARTIFACT_DIR`
- `VCFA_WORKFLOW_DIR`
- `VCFA_ACTION_DIR`
- `VCFA_CONFIGURATION_DIR`
- `VCFA_RESOURCE_DIR`
- `VCFA_PACKAGE_DIR`
- `VCFA_CONTEXT_DIR`

Artifact file arguments should be plain file names under the matching configured directory. Do not pass paths, absolute paths, or traversal segments.

## Package-First Publishing

Reusable project content should move through the stable project package flow by default.

- Reuse the exact `VCFA_PROJECT_PACKAGE_NAME`. Do not create random, timestamped, or task-specific package names.
- Use `ensure-project-package` only for the configured project package. It creates the package only when explicitly requested and confirmed.
- Add live content to that package with `add-workflow-to-project-package`, `add-action-to-project-package`, `add-configuration-to-project-package`, or `add-resource-to-project-package`.
- Run `rebuild-project-package` before export.
- Export with `export-project-package`.
- Inspect with `get-project-package-import-details`.
- Import with `import-project-package` only after confirming that the package name and element list match the intended change.

Use direct artifact imports such as `import-workflow-file`, `import-action-file`, or `import-configuration-file` only for narrow validation or explicitly requested one-off tests. Normal project promotion should go through the package path.

## Workflow Authoring Rules

Before authoring or importing workflow artifacts, read `docs/vro-artifact-authoring.md` and the relevant pattern resources.

- `create-workflow` creates an empty workflow shell. Use real `.workflow` artifacts or package publishing for executable workflow content.
- Prefer native vRO action workflow items when a workflow step only invokes one existing action. Use scriptable tasks for multiple action calls, input shaping, branching, validation, aggregation, or other custom logic.
- `scaffold-workflow-file` emits both kinds of workflow item. For a single-action wrapper, pass a task with `kind: "action"` (`module`, `actionName`, ordered `inputs`, and `resultBinding`) to generate a native action item directly; use `kind: "script"` (the default) for scriptable tasks.
- In exported XML, native action items still appear as `type="task"` with `script-module="<module>/<actionName>"`. Preserve the generated script that assigns the result to `actionResult`; a `script-module` without the generated script can import and run but return `undefined`.
- Prefer horizontal workflow layouts in authored XML/package content. Place sequential items left-to-right with increasing `x` positions and stable `y` positions unless a branch needs separation.
- Workflows with inputs need a valid `input_form_` so they can start from the vRO UI. Use UTF-16BE JSON with a BOM, page-level titles, section objects containing only `id` and `fields`, field IDs that match `schema` keys, and `options.externalValidations: []`. Do not add section `title` or unverified field properties such as `size`.
- Keep scriptable task code readable and defensive. Runtime errors often reference workflow item line numbers.

## Template, Subscription, Catalog, And Deployment Rules

- For Cloud Assembly templates, inspect existing templates with `list-templates` and `get-template` (set `includeContent: true` to read the YAML) before drafting YAML. Reuse discovered resource types, inputs, image/flavor/network conventions, constraints, and catalog patterns. Do not invent provider-specific YAML.
- Confirm the target `projectId` and template content before calling `create-template` with `confirm: true`.
- For catalog work, inspect `list-catalog-items` and `get-catalog-item` before creating deployments.
- For deployments, inspect `get-deployment` and `list-deployment-actions` before proposing remediation. Do not run `run-deployment-action` until the user confirms the action, inputs, target deployment, and expected impact.
- For extensibility subscriptions, inspect `list-event-topics`, `list-subscriptions`, and `get-subscription` (set `includeConstraints: true` to read constraints) first. During testing, disabling or updating a subscription may be safer than deleting it.

## Code And Documentation Changes

- Keep changes focused. Do not rewrite unrelated modules, generated docs, or built artifacts unless the task requires it.
- Use existing client helpers and patterns before adding new low-level API calls.
- When adding a tool, update the relevant `src/tools/*` module, mark read-only and destructive annotations accurately, add tests, update `docs/reference/tools.md`, and update relevant how-to docs.
- When adding or changing a prompt or resource, update `src/prompts/index.ts` or `src/resources/index.ts` and `docs/reference/resources-prompts.md`.
- Keep checked examples in `examples/README.md` aligned with registered tool and prompt names.
- For docs pages, update `docs/.vitepress/config.ts` when adding sidebar entries.
- Never print secrets from configuration values, workflow scripts, action scripts, tokens, passwords, or private keys. Prefer names, IDs, types, descriptions, and redacted summaries.

## Validation

Use the smallest meaningful validation for the change, and run the full gate for broad behavior, docs, or release-facing changes.

- Dev server: `npm start`
- Build: `npm run build`
- Unit tests: `npm test`
- Coverage gate: `npm run test:coverage:check`
- Docs/examples drift: `npm run validate:docs`
- Docs dev server: `npm run docs:dev`
- Docs build: `npm run docs:build`
- Docs preview: `npm run docs:preview`
- Package contents: `npm run validate:package`
- Full local gate: `npm run validate`
- MCP inspector after build: `npm run inspect`

`npm run validate` should not contact a live VCFA environment. Keep live smoke checks separate. Read-only list/get checks are appropriate in sandbox environments; imports, deletes, template creation, subscription changes, deployment actions, and package imports require explicit confirmation and disposable test assets.

## GitHub Actions

Current repository workflows run CI on pull requests and pushes to `main`, validate package contents when package-relevant files change, deploy docs to GitHub Pages from `main` or manual dispatch, run CodeQL on PRs, `main`, and a weekly schedule, review dependency changes on PRs, and publish to npm only for published GitHub releases.

## GitHub Issue Convention

- Use `VCFO-###` for repository issue codes, starting at `VCFO-001` and incrementing sequentially.
- Prefix issue titles with the code, for example `[VCFO-001] Expand MCP resources and prompts for workflow/template implementation`.

## Completion Expectations

For code or artifact changes, report what changed, how it was verified, and any remaining risk. If required discovery cannot find a category, workflow, action, project, template, parameter, return type, package, or schema detail, stop and report the missing fact instead of filling the gap from memory.
