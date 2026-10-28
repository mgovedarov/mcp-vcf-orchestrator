---
name: VCF Orchestrator Agent
description: Practical operating instructions for AI agents working on the VCF Automation Orchestrator MCP server
trigger: "vcfa-orchestrator"
---

# VCF Orchestrator Agent

## What This Is

An MCP server, served over stdio, that exposes VCF Automation Orchestrator (vRO), Service Broker, and Cloud Assembly REST operations to AI assistants, and also targets vRA/vRO 8.12+ through `VCFA_TARGET_PLATFORM=vra8`, reads and writes alike. Agents working here should be discovery-first, conservative with live environments, and biased toward real importable artifacts over illustrative pseudocode.

Use these instructions for all work in this repository. If a more specific `AGENTS.md` exists in a subdirectory, apply that file for its subtree and keep compatible guidance from this file. When instructions conflict, the deeper file wins for files in its scope. The sections down to **Docs** cover working on the codebase; the **Operating Playbook** after them covers driving a live VCFA/vRO environment through this server's tools.

## Layout

| Path | Owns |
|---|---|
| `src/index.ts` | Entry point: `main` reads env, builds `VroClient`, calls every `register*` function, connects stdio |
| `src/client/` | Auth, HTTP and errors (`core.ts`), one client class per domain, the `VroClient` facade (`index.ts`), artifact helpers (`files.ts`, `artifact-preflight.ts`, `workflow-artifact.ts`, `context-snapshot.ts`) |
| `src/tools/` | One `register<Domain>Tools` module per domain, plus shared `annotations.ts`, `confirmation-guards.ts`, `truncation.ts`, `content-summary.ts` |
| `src/resources/`, `src/prompts/` | `vcfa://` resources and `vcfa-*` prompt playbooks |
| `src/*.ts` (rest) | `redaction.ts` (secret withholding), `resource-views.ts`, `content-metadata.ts` (the sha256-and-length stand-in for withheld content), `types.ts`, `context-directory.ts`; `vro-client.ts` is the public re-export shim |
| `test/` | Node test runner suites `*.test.mjs`; they import `dist/`, not `src/` |
| `scripts/` | `validate-docs.mjs` (registry, link and example drift), `validate-package.mjs` (npm file set) |
| `docs/` | VitePress site, deployed to GitHub Pages and shipped in the npm tarball (the `files` list in `package.json`); `docs/project/` holds the internals docs |
| `examples/` | Checked tool-call examples |
| `skills/`, `.claude-plugin/` | The shipped Claude Code plugin (product content, not dev config; keep skills thin) |

## Commands

These are the declared commands and where they are defined. The gates in `.agents/gates.md` ran Install and Full local gate green on Node 22 on 2026-10-28, which covers Build, Tests, Coverage gate, Docs/examples drift, the docs build, and Package contents. The other rows are not yet verified by running.

| Task | Command | Defined in |
|---|---|---|
| Install | `npm ci` | the install step in `.github/workflows/ci.yml` |
| Build (`tsc` to `dist/`) | `npm run build` | `package.json` script `build` |
| Start (stdio; needs env) | `npm start` | `package.json` script `start` |
| Tests (builds first) | `npm test` | `package.json` script `test` |
| One test file | `npm run build && node --test test/<file>.test.mjs` | composed from the `test` script |
| Filter within a file | `node --test --test-name-pattern="<regex>" test/<file>.test.mjs` | Node test runner flag |
| Coverage gate (lines 80, branches 70, functions 80) | `npm run test:coverage:check` | `package.json` script `test:coverage:check` |
| Docs/examples drift | `npm run validate:docs` | `package.json` script `validate:docs` |
| Package contents | `npm run validate:package` | `package.json` script `validate:package` |
| Full local gate | `npm run validate` | `package.json` script `validate` |
| Docs dev / build / preview | `npm run docs:dev` / `npm run docs:build` / `npm run docs:preview` | `package.json` scripts `docs:*` |
| MCP Inspector (after build) | `npm run inspect` | `package.json` script `inspect` |

- Toolchain: Node `>=22.19.0` (`engines` in `package.json`, driven by `undici` 8); `.nvmrc` pins 24. CI runs `npm test` on Node 22 and 24 and `npm run validate` on 24 (`.github/workflows/ci.yml`).
- Use the smallest meaningful check for a change, and run `npm run validate` before broad, docs, or release-facing changes.
- `npm run validate` must not contact a live VCFA environment. Live smoke checks stay separate: read-only list/get checks are fine against a sandbox; imports, deletes, template creation, subscription changes, deployment actions, and package imports need explicit user confirmation and disposable test assets.
- Environment: `VCFA_HOST`, `VCFA_USERNAME`, `VCFA_ORGANIZATION`, `VCFA_PASSWORD` are required, and the process exits 1 without them (`getRequiredEnv` in `src/index.ts`). Every optional variable and default is in `docs/guide/configuration.md` and `.env.example`.

## Conventions

- Keep changes focused. Do not rewrite unrelated modules, generated docs, or built artifacts unless the task requires it. Use existing client helpers and patterns before adding new low-level API calls.
- Tools register inside an exported `register<Domain>Tools(server, client)` with `server.registerTool(name, { title, description, inputSchema: z.object(...), annotations }, handler)`; model on `registerCategoryTools` in `src/tools/category-tools.ts`. `validate-docs` finds tools by that literal `.registerTool(` call.
- Tool handlers catch every error and return `{ content: [{ type: "text", text: "Failed to <verb>: <message>" }], isError: true }`, as `list-categories` does. There is no shared error-result helper.
- Client errors are plain `Error`s with a numeric `status` attached, message `vRO API error: <status> <reason> — <label>` plus a sanitized body and hint (`apiError` in `src/client/core.ts`). Branch on `apiErrorStatus(error)`, not on message text; there are no custom error classes.
- Mutating tools take `confirm: z.boolean()` and return a plain, non-error instruction when it is false, as `delete-template` in `src/tools/template-tools.ts` does. `expected*` arguments are checked against live metadata with `guardExpectedFields` in `src/tools/confirmation-guards.ts`, which returns `isError: true` on a mismatch. Most tools check `confirm` first. `update-configuration` is the exception: it reads the live element and runs its guards before the `confirm` check, so a guard mismatch is an error there even when `confirm` is false. New mutating tools offer the same two-phase flow; the schema flag never replaces asking the user.
- Annotations: read-only tools use `{ readOnlyHint: true }`; a tool that overwrites, deletes, executes, or provisions uses `DESTRUCTIVE_LIVE_WRITE` in `src/tools/annotations.ts`.
- Every `list-*` tool that walks pages appends `truncationNote` in `src/tools/truncation.ts`, on the empty branch too. `list-workflow-executions` and `list-deployment-actions` read a single response and have no page walk to report, and `list-workflows-by-category` renders its own category-limit note. Bulky content that a `get-*` tool omits by default goes through `omittedContentSummary` in `src/tools/content-summary.ts`.
- HTTP goes only through the npm `undici` `fetch`, `FormData`, and `Agent`, imported in `src/client/core.ts`. `requestFetch` and `createUploadForm` pick the fetch and build the form, and the `VroHttpClient` constructor builds the `VCFA_IGNORE_TLS` `Agent`. A new domain client is a class over `VroHttpClient`, constructed in `VroClient` in `src/client/index.ts`.
- Log with `console.error` only, prefixed `[vcfa-server]` or `[vro-client]`; stdout carries the MCP stdio transport. Never log tokens or passwords.
- Environment variables are read in `src/index.ts` only, plus `VCFA_CONTEXT_DIR` in `src/context-directory.ts`.
- ESM with NodeNext: relative imports end in `.js` (`moduleResolution` in `tsconfig.json`); source files use kebab-case names such as `*-tools.ts` and `*-client.ts`.
- Tests never contact a live VCFA environment:
  - Clients are exercised with in-memory fakes, a stubbed `globalThis.fetch` (`test/vro-client.test.mjs`), or a loopback TLS server (`test/tls-integration.test.mjs`).
  - `test/index-startup.test.mjs` spawns the built `dist/index.js` with a controlled environment to cover startup failures and graceful `SIGTERM` shutdown.
- The server version is read from `package.json` (`SERVER_VERSION` in `src/index.ts`, asserted by `test/version-sync.test.mjs`); never hardcode it.
- Adding a tool: update the relevant `src/tools/*` module, mark read-only and destructive annotations accurately, add tests, update `docs/reference/tools.md` (one drift-checked heading per tool) and the relevant how-tos. A new tool module also needs its register call in `main` in `src/index.ts` and in `registerAllToolConfigs` in `test/tool-annotations.test.mjs`.
- Docs and instruction files cite source by file and symbol, never by line number, because a line number goes stale with the next edit to the cited file. `npm run validate:docs` enforces it.
- Adding or changing a prompt or resource: update `src/prompts/index.ts` or `src/resources/index.ts` and `docs/reference/resources-prompts.md`. Keep checked examples in `examples/README.md` aligned with registered tool and prompt names. New docs pages get a sidebar entry in `docs/.vitepress/config.ts`.
- The Claude Code skills must stay thin: they delegate to the `vcfa-*` prompts, `vcfa://` resources, and tools and must not re-document them. Tool/prompt/resource names referenced in a `SKILL.md` are drift-checked by `npm run validate:docs`; add any legitimate new non-tool kebab term to `KNOWN_NON_REGISTRY_TERMS` in `scripts/validate-docs.mjs`.
- Never print secrets from configuration values, workflow and action scripts, workflow execution output parameters, tokens, passwords, or private keys. Prefer names, IDs, types, descriptions, and redacted summaries.
- A value carrying a declared type is withheld on that type, not on its name: `isSecureAttributeValue` in `src/redaction.ts` reads both the declared type and the value envelope, and a surface that prints such a value calls `formatVroValueRedacted` rather than the unguarded `formatVroValue` — `get-configuration` is the one caller of the latter, because it runs the same check itself to reach a third branch for an attribute vRO returned no value for. The key-name heuristic in the same module is the weaker fallback, for the untyped free-form maps that carry no type at all. Neither reaches inside an untyped composite, or into log lines and exception text, which are served verbatim — say so wherever the tool description or docs claim withholding.

## Gotchas

- Tests pass or fail against old code → tests import `dist/`. `npm test` builds first; run `npm run build` before any direct `node --test`.
- A multipart import sends `[object FormData]` as `text/plain`, or `VCFA_IGNORE_TLS` is ignored → Node's global `fetch`/`FormData` was used; the runtime-bundled undici is a different major. Route through `requestFetch` and `createUploadForm` in `src/client/core.ts`, which use the npm undici ones. Unit tests may still stub `globalThis.fetch`; `requestFetch` honors a swapped global.
- `npm run validate:docs` fails with `unknown documented call` → in `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/`, `examples/`, and `skills/`, any lowercase hyphenated word followed by an opening parenthesis must be a registered tool or prompt, and the phrase "Use" + word + "with:" must name a tool (`validateExampleToolCalls` in `scripts/validate-docs.mjs`). Reword the sentence.
- `npm run validate:docs` fails with `Stale source citations` → a Markdown file under the checked roots, `.agents/`, or `.claude/` cites a file with a line number (`:12` or `#L12`, in backticks, a link, or plain prose), names a repo path or a backticked file name that no longer exists anywhere in the repo, or cites a symbol "in" a file that no longer contains it outside comments (`sourceCitationProblems` in `scripts/validate-docs.mjs`). Cite the file and a symbol that is still there. Dotfiles such as `.nvmrc` are not checked, and gitignored files under `.claude/` are not scanned.
- `npm run docs:build` fails with `dead link(s) found` → a page under `docs/` links outside `docs/` (for example a relative link to `AGENTS.md`). Link docs pages by `.md` path; write repo paths as inline code or full GitHub URLs. A bare angle-bracket placeholder or a double curly brace in a docs page also breaks the Vue compile.
- `test/tool-annotations.test.mjs` fails on a new tool → a tool named `import-…`, `delete-…`, `update-…`, or `run-…` must use `DESTRUCTIVE_LIVE_WRITE` and be listed in `DESTRUCTIVE_TOOLS` (`DESTRUCTIVE_NAME_PATTERN` in `test/tool-annotations.test.mjs`).
- A PR is blocked by a required check stuck at "Expected — Waiting for status to be reported" → a required job was renamed, matrixed, or path-filtered. Required checks match job names exactly; never add a `paths` filter to a required workflow, and update branch protection before moving a job (see the header comments in `.github/workflows/codeql.yml` and `.github/workflows/package-check.yml`).
- CodeQL fails on a single Dependabot bump → `github/codeql-action` init, autobuild, and analyze must move together (the `codeql-action` group in `.github/dependabot.yml`).
- A shutdown signal during startup leaves the child exiting with code `null` → signal handlers are registered before `server.connect` in `main` (`src/index.ts`); keep that order.
- The npm publish fails at "Verify tag matches package version" → the release tag must equal `v` plus the `package.json` version (`.github/workflows/npm-publish.yml`).
- Deleting a workflow, action, or configuration right after a package delete answers `409 Conflict` → retry the same delete first; see **Package-First Publishing** below.
- `git fetch` fails with `cannot lock ref 'refs/remotes/origin/main'`, or because a `.lock` file exists → another worktree or role fetched at the same moment, and worktrees share refs. Wait a few seconds and run the same fetch again.

## Git/PR Rules

- The repository is public. Keep hostnames, IPs, organization or tenant names, and customer identifiers out of issues, PRs, commits, tests, and docs; use placeholders such as `vcfa.example.com` (precedent: the VCFO-113 entry in `CHANGELOG.md`).
- Planning lives in GitHub Issues; `TODO.md` is deprecated and kept for history only. Use `VCFO-###` issue codes, sequential from `VCFO-001`, prefixed in titles: `[VCFO-001] Expand MCP resources and prompts for workflow/template implementation`. Take the next code from a title search across issues and PRs, not from the issue number; the two diverge.
- Branch from a freshly fetched `origin/main` as `vcfo-<NNN>-<kebab-slug>`, not from a local `main` that may lag behind; releases use `release/X.Y.Z`.
- PR title: `[VCFO-###] <imperative sentence>`; several codes stack as `[VCFO-112][VCFO-113] …`. Maintenance without an issue uses `chore: …`. PRs are squash-merged, so the title and body become the commit.
- PR body: the first line is `Closes #N.`, topical `##` sections follow, and the last section is `## Verification` (what ran, the results, what was not exercised).
- `CHANGELOG.md` keeps an `## Unreleased` section at the top with `### Added` / `### Changed` / `### Fixed` / `### Dependencies` / `### Docs` / `### Tests` subsections as needed. Add an entry for every user-visible change as `- **Bold one-sentence lead.** Explanation (VCFO-###).` Releases rename the section to `## <version> - <date>`.
- Release: a `chore: release X.Y.Z` PR bumps `CHANGELOG.md`, `package.json`, `package-lock.json`, and, when `skills/` changed, the `version` in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`. Then tag `vX.Y.Z` and publish a GitHub Release, which runs `npm-publish.yml`.
- GitHub Actions: CI runs on pull requests and pushes to `main`; package contents are verified on every pull request and push to `main` (no `paths` filter); docs deploy to GitHub Pages from `main` or manual dispatch; CodeQL runs on PRs, `main`, and a weekly schedule; dependency review runs on PRs; npm publishing runs only for published GitHub releases.
- File unrelated bugs as issues (the `issue-filer` role); don't widen scope.

## Working With Subagents

When writing code, the main session orchestrates and hands work to the tool-neutral roles in `.agents/roles/`:

| Role | Use it to | Claude Code subagent |
|---|---|---|
| `scout` | enumerate call sites, files, and patterns with `path:line`, no judgment | `.claude/agents/scout.md` (haiku; Read, Grep, Glob, Bash) |
| `researcher` | answer "how does X work" before changing it | `.claude/agents/researcher.md` (opus; Read, Grep, Glob, Bash) |
| `coder` | implement one issue on its own branch or worktree and open a PR | `.claude/agents/coder.md` (opus, all tools except the `vcf-orchestrator` MCP tools and `Agent`) |
| `reviewer` | review the diff before a PR is opened or merged | `.claude/agents/reviewer.md` (opus; Read, Grep, Glob, Bash) |
| `issue-filer` | file bugs found along the way | `.claude/agents/issue-filer.md` (haiku, all tools except the `vcf-orchestrator` MCP tools and `Agent`) |
| `test-runner` | run a gate's commands and report pass/fail, never editing | `.claude/agents/test-runner.md` (haiku; Read, Grep, Glob, Bash) |
| `remediator` | fix an open PR: update it with `main`, resolve conflicts, apply review findings and gate failures | `.claude/agents/remediator.md` (opus, all tools except the `vcf-orchestrator` MCP tools and `Agent`) |

- Claude Code runs these as native subagents. A tool without subagents, or a subagent that cannot start its own, reads the role file and follows it inline.
- `scout`, `researcher`, `reviewer`, and `test-runner` are read-only by their role files, not by their tool lists. Each keeps Bash, which can write, push, and comment.
- `coder` and `remediator` don't file issues. They return `BUG:` lines, and the main session hands them to `issue-filer` one at a time, because each filing takes the next `VCFO-###` code.
- Roles never call the live VCFA/vRO tools; a change that needs live verification goes back to the main session, which confirms target and impact with the user first.
- The orchestrator verifies what a role claims (for example by reading `gh pr diff <n>`) instead of trusting its summary.

## Agent Commands

Shared procedures live in `.agents/commands/` (`issue.md`, `process-issues.md`). In Claude Code, `/issue <brief>` runs the first in the `issue-filer` subagent. `/process-issues [limit]` runs the processing loop in the main session, and only when you invoke it.
The loop reads issues through `.agents/sources/github-issues.md` and gates every PR with `.agents/gates.md`.

## Docs

System internals (architecture, client layer, MCP surface, glossary): `docs/project/README.md`. User guides and references are the rest of `docs/`, published to GitHub Pages.

## Operating Playbook

How to drive a live VCFA/vRO environment through this server's tools, prompts, and resources.

### First Principles

- Read existing code and docs before planning or editing. Prefer repo-specific guidance over generic MCP, VCFA, vRO, or TypeScript advice.
- Preserve existing patterns. Add abstractions only when they reduce real duplication or match an established local pattern.
- Do not invent VCF Automation/vRO IDs, schemas, workflow parameters, action contracts, package names, project IDs, category IDs, blueprint YAML, or MCP tool behavior. Verify from docs, source, or configured MCP tools.
- Treat live VCFA/vRO writes as environment changes. Use read-only discovery first and ask for explicit confirmation before create, update, import, delete, deployment day-2, template, subscription, deployment, package, or local overwrite operations.
- Keep local artifact work inside configured artifact directories. Do not bypass path safety with absolute paths, traversal, symlinks, or ad hoc filesystem writes.
- Prefer deterministic, reviewable workflows: discover, export or snapshot, author locally, preflight, diff, prepare promotion, confirm, import, verify.

### Source Of Truth

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

If the docs and source disagree, inspect the source, update the docs or examples, and run the docs validation gate.

### Current MCP Tool Surface

Use the exact registered tool names. Start with list/get tools unless the user has already provided verified IDs and contracts.

- Context and promotion: `collect-context-snapshot`, `prepare-artifact-promotion`
- Workflows: `list-workflows`, `list-workflows-by-category`, `get-workflow`, `create-workflow`, `run-workflow`, `run-workflow-and-wait`, `list-workflow-executions`, `get-workflow-execution`, `get-workflow-execution-logs`, `export-workflow-file`, `scaffold-workflow-file`, `preflight-workflow-file`, `diff-workflow-file`, `import-workflow-file`, `delete-workflow`
- Actions: `list-actions`, `get-action`, `create-action`, `update-action`, `export-action-file`, `preflight-action-file`, `diff-action-file`, `import-action-file`, `delete-action`
- Configuration elements: `list-configurations`, `get-configuration`, `create-configuration`, `update-configuration`, `export-configuration-file`, `preflight-configuration-file`, `import-configuration-file`, `delete-configuration`
- Resource elements: `list-resource-elements`, `export-resource-element`, `import-resource-element`, `update-resource-element`, `delete-resource-element`
- Packages: `list-packages`, `get-package`, `create-package`, `ensure-project-package`, `add-workflow-to-project-package`, `add-action-to-project-package`, `add-configuration-to-project-package`, `add-resource-to-project-package`, `rebuild-project-package`, `export-package`, `export-project-package`, `preflight-package`, `get-package-import-details`, `get-project-package-import-details`, `import-package`, `import-project-package`, `delete-package`
- Categories and plugins: `list-categories`, `list-plugins`
- Templates: `list-templates`, `get-template`, `create-template`, `delete-template`
- Subscriptions and event topics: `list-event-topics`, `list-subscriptions`, `get-subscription`, `create-subscription`, `update-subscription`, `delete-subscription`
- Projects: `list-projects`, `get-project`
- Catalog and deployments: `list-catalog-items`, `get-catalog-item`, `list-deployments`, `get-deployment`, `list-deployment-requests`, `get-deployment-request`, `create-deployment`, `delete-deployment`, `list-deployment-actions`, `run-deployment-action`

Many write-capable tools require a `confirm: true` argument before they mutate state. That schema requirement does not replace user confirmation. Confirm the exact target, expected impact, and rollback or backup plan before calling live create, update, import, delete, deployment, day-2, package, or local overwrite tools.

In `vra8` mode the client authenticates with the vRA 8 bearer-token flow, a vIDM CSP login with `VCFA_ORGANIZATION` as the domain followed by a refresh-token exchange at `/iaas/api/login`. VCFO-068 verified that mode against a vRA 8.18 lab (vRO 8.18.1), and the supported surface is now per service:

- **vRO `/vco/api`: fully supported**, reads and writes alike — create/update/delete of workflows, actions, and configuration elements, the multipart artifact imports, package build and export, and workflow execution.
- **Automation-service reads: supported.** The list and get paths of the catalog, deployment, blueprint, project, and event-broker services return the same Spring page envelope and object shapes the VCFA 9.x clients parse. No `apiVersion` pin is needed: none of those clients sends one and every endpoint answered without it.
- **Blueprint-service and event-broker writes: supported.** `create-template`, `delete-template`, and the subscription create/update/delete tools were verified against a vRA 8.18 lab under VCFO-070 with a disposable DRAFT template and a disposable disabled subscription; neither provisions infrastructure. `create-template` is also the one place the two platforms diverge on a *request* rather than on support: vRA 8 creates an empty template when `content` is omitted, VCF Automation 9.1 refuses that request with an opaque `400` (VCFO-099). Always send `content`; the 9.1 refusal is reported with that guidance appended rather than pre-empted, since the vRA 8 path works.
- **Catalog-service and deployment-service writes: supported.** `create-deployment`, `delete-deployment` and `run-deployment-action` were verified against the same vRA 8.18 lab under VCFO-088 once it held a released catalog item: a disposable deployment was requested, powered off and on, and deleted through the real tool handlers, each `expected*` guard refused a mismatch first, and the environment was returned to its starting count. The wire shapes match VCF Automation 9.1 — a bare array of `{deploymentId, deploymentName}` from the catalog request, a bare array of six-key action objects, and a `DeploymentRequest` from both a day-2 submission and a `DELETE`. Each path still provisions, alters or destroys real infrastructure; the `confirm` gate and the target guards are the safety surface, not the platform. Only project-service writes remain refused, because no write path to it exists yet.
- **`export-configuration-file`: unsupported.** vRA 8 serves a single configuration element as JSON only and answers an artifact request with `406`, while the same request for a workflow or an action returns the artifact. Read it with `get-configuration`, or add it to the project package and export that. For the same reason `prepare-artifact-promotion` reports a configuration backup as skipped in this mode and still returns the preflight report, diff, and import recommendation.
- **`import-configuration-file`: unverified.** The endpoint is reachable and the multipart transport is proven by the workflow, resource, and package imports, but vRA 8 cannot export a `.vsoconf`, so no genuine container was round-tripped. It is not guarded. VCFO-075 confirmed this cannot be settled on vRA 8 at all: a project-package export stores elements as `elements/<id>/data`, not as `.vsoconf` members, so the platform offers no container to feed back.
- **Action modules must already exist for `import-action-file`.** vRO 8.18.1 answers an unknown `categoryName` with `404 Action category name not found`; it does not create the module on import. `create-action` does create one implicitly, so use it to establish a new module. Deleting a module's last action also removes the module (VCFO-075/VCFO-079).
- **Export and diff of an action take the element ID, not the fully qualified name.** vRO serves `GET /actions/<module>/<name>` as JSON but answers the same path with an artifact `Accept` with an opaque `400`; the client now resolves an FQN to its ID before the artifact request (VCFO-076).
- **`expectedCategoryName` cannot be verified for a resource element on vRA 8.** The platform's resource listing carries no category, so `update-resource-element` and `delete-resource-element` refuse that argument with an explanation rather than reporting a false mismatch (VCFO-077). Confirm placement with `list-resource-elements`.

The full per-tool result of the VCFO-075 sweep — all 78 tools driven through the real handlers against a vRA 8.18 lab — is in `docs/operations/vra8-verification-matrix.md`.

Subscription writes differ by platform in that mode, all three verified under VCFO-070: vRA 8 requires the client to choose the subscription id (a body without one answers `500 The given id must not be null`), it answers the create `201` with an empty body and the created element in the `Location` header, and it serves neither `PUT` nor `PATCH` on `/subscriptions/{id}` (both `405`). So `create-subscription` generates a UUID and re-reads the element (returning the posted body if that read-back has not caught up, since a thrown error there would invite a retry that creates a second subscription), and `update-subscription` lays the caller's changes over the live element and upserts the whole body with a `POST`. That upsert replaces the element, so the body starts from the live one and strips only server-owned fields (`orgId`, `ownerId`, `subscriberId`, `system`, `contextual`, `selfLink`); the element's own `type` and any field `Subscription` does not model carry forward rather than being cleared. The server catches no merge gap — `400 Property: eventTopicId must not be blank` only fires when `eventTopicId` is absent, and the merge always carries it — so an element with no `eventTopicId` is refused client-side before the write. vRA 8 also serves system subscriptions with no `name` at all, so `Subscription.name` is optional and renderers print `(unnamed)`.

One configuration write body still differs by platform in that mode: `PUT /configurations/{id}` must carry the element name. The attribute key no longer does — every platform sends the plural `attributes`, since VCFA 9.1 accepts it on create and update alike (VCFO-074) and vRA 8 answers `400` for the singular `attribute`, even alongside the plural one. On both platforms that `PUT` replaces the element, so `update-configuration` reads the live element once — before the `confirm` gate — and carries an omitted name and description forward; an omitted attribute set on an element that has attributes is refused instead, naming the secure ones whose values must be supplied fresh, and a secure attribute sent without a value is refused.

On the default `vcfa` platform, the client auto-negotiates the VCF Cloud API version (`9.1.0` preferred, then `9.0.0`) via the unauthenticated `GET /api/versions` discovery document; `VCFA_TARGET_PLATFORM=vcfa9.1` or `vcfa9.0` pins it. Logins with `VCFA_ORGANIZATION=system` (case-insensitive) are routed to `/cloudapi/1.0.0/sessions/provider` for provider/system administrators; tenant logins use `/cloudapi/1.0.0/sessions` with the organization name (URL slug), not its display name. A provider session reads vRO normally but cannot read the tenant-scoped Automation services — project-service answers `403` and the catalog, deployment, blueprint and event-broker services answer `500`, and the error carries a hint naming `VCFA_ORGANIZATION` (VCFO-085). The event-broker tools are a separate case: they are **not** reachable on a tenant session either, where both listings answer `403` because the account lacks the role that service requires, so `list-event-topics`, `list-subscriptions`, `get-subscription` and the three subscription writes have no 9.x verification at all and need an RBAC change rather than a different session (VCFO-099). When `VCFA_VRO_HOST` is set (an external vRO appliance, on `vcfa` or `vra8`), only the vRO `/vco/api` base moves to that host; the login endpoints, the `/api/versions` probe, and the Automation services stay on `VCFA_HOST`, the Automation-issued token is reused verbatim, and every request log line and `vRO API error` then ends with ` on <host>` naming the appliance that answered — the JSON path and the binary export/import paths alike (VCFO-081).

### Current MCP Prompts And Resources

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

A live-object resource withholds what its matching `get-*` tool withholds, so a gate cannot be sidestepped by reading the URI instead: an action's script and a subscription's constraints are served as a `{ included: false, sha256, length }` summary, and a secure-typed configuration attribute or a credential-named deployment input as `[redacted]`. Use the named tool and flag for the full content. See `docs/reference/resources-prompts.md`.

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

### Artifact Lifecycle

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
- `VCFA_EXECUTION_LOG_DIR`
- `VCFA_CONTEXT_DIR`

Artifact file arguments should be plain file names under the matching configured directory. Do not pass paths, absolute paths, or traversal segments.

### Package-First Publishing

Reusable project content should move through the stable project package flow by default.

- Reuse the exact `VCFA_PROJECT_PACKAGE_NAME`. Do not create random, timestamped, or task-specific package names.
- Use `ensure-project-package` only for the configured project package. It creates the package only when explicitly requested and confirmed.
- Add live content to that package with `add-workflow-to-project-package`, `add-action-to-project-package`, `add-configuration-to-project-package`, or `add-resource-to-project-package`.
- Run `rebuild-project-package` before export.
- Export with `export-project-package`.
- Inspect with `get-project-package-import-details`.
- Import with `import-project-package` only after confirming that the package name and element list match the intended change.

Use direct artifact imports such as `import-workflow-file`, `import-action-file`, or `import-configuration-file` only for narrow validation or explicitly requested one-off tests. Normal project promotion should go through the package path.

Deleting a package with `deleteContents: false` leaves its members behind, and on 9.x vRO releases them asynchronously. For roughly two seconds afterwards a plain `delete-workflow`, `delete-action`, or `delete-configuration` can answer `409 Conflict` reporting the element as in use. **Retry the same delete first** — that is what clears it. `force: true` exists for an element that is genuinely referenced and should be the second step, never the first: it skips vRO's reference check rather than showing nothing depends on the element, so forcing a merely-transient refusal can destroy a reference that mattered. The 409 carries a hint saying exactly this (VCFO-087).

### Workflow Authoring Rules

Before authoring or importing workflow artifacts, read `docs/vro-artifact-authoring.md` and the relevant pattern resources.

- `create-workflow` creates an empty workflow shell. Use real `.workflow` artifacts or package publishing for executable workflow content.
- Prefer native vRO action workflow items when a workflow step only invokes one existing action. Use scriptable tasks for multiple action calls, input shaping, branching, validation, aggregation, or other custom logic.
- `scaffold-workflow-file` emits both kinds of workflow item. For a single-action wrapper, pass a task with `kind: "action"` (`module`, `actionName`, ordered `inputs`, and `resultBinding`) to generate a native action item directly; use `kind: "script"` (the default) for scriptable tasks.
- In exported XML, native action items still appear as `type="task"` with `script-module="<module>/<actionName>"`. Preserve the generated script that assigns the result to `actionResult`; a `script-module` without the generated script can import and run but return `undefined`.
- Prefer horizontal workflow layouts in authored XML/package content. Place sequential items left-to-right with increasing `x` positions and stable `y` positions unless a branch needs separation.
- Workflows with inputs need a valid `input_form_` so they can start from the vRO UI. Use UTF-16BE JSON with a BOM, page-level titles, section objects containing only `id` and `fields`, field IDs that match `schema` keys, and `options.externalValidations: []`. Do not add section `title` or unverified field properties such as `size`.
- Only the input types in the supported input-form mapping table in `docs/vro-artifact-authoring.md` can be scaffolded (`string`, `boolean`, `number`, `SecureString`, `Date`, `Properties`, `Any`, reference types, and `Array` of supported types); other types fail scaffold/preflight instead of becoming `string` fields. Preflight also cross-checks `input_form_` fields/schema against the inputs declared in `workflow-content` (field with no input = error, input with no field = warning, dataType mismatch = warning).
- Keep scriptable task code readable and defensive. Runtime errors often reference workflow item line numbers.

### Template, Subscription, Catalog, And Deployment Rules

- For Cloud Assembly templates, inspect existing templates with `list-templates` and `get-template` (set `includeContent: true` to read the YAML) before drafting YAML. Reuse discovered resource types, inputs, image/flavor/network conventions, constraints, and catalog patterns. Do not invent provider-specific YAML.
- Confirm the target `projectId` with `list-projects` or `get-project` and the template content before calling `create-template` with `confirm: true`. Always pass `content`: it is schema-optional, but only vRA 8 creates an empty template without it — VCF Automation 9.1 answers an opaque `400`, and a minimal `formatVersion: 1` document is the smallest accepted one.
- For catalog work, inspect `list-catalog-items` and `get-catalog-item` before creating deployments. `create-deployment` provisions real infrastructure and is annotated destructive for that reason; pass `expectedCatalogItemName` and `expectedProjectName` from that discovery so the live target is verified before the request is submitted, and confirm the catalog item, project, inputs, and expected cost with the user first.
- For deployments, inspect `get-deployment` and `list-deployment-actions` before proposing remediation. `get-deployment` renders the inputs the deployment was requested with, which is what distinguishes two deployments of one catalog item requested against different blueprint versions; an input whose name reads as credential material is withheld, but that check is name-based, so treat the block as potentially sensitive output. Use `list-deployment-requests` to see what has been requested against the deployment and to obtain a request ID that was not captured at submission — including the create request's, which the catalog request never returns; that listing answers `404` once the deployment is gone, while each request it listed still reads by ID. When a request ID is known, use `get-deployment-request` for its status and task progress; a deployment's own status does not track non-delete day-2 actions. Do not run `run-deployment-action` until the user confirms the action, inputs, target deployment, and expected impact. Poll the returned request ID afterwards, and for a delete also verify that the deployment is absent.
- For extensibility subscriptions, inspect `list-event-topics`, `list-subscriptions`, and `get-subscription` (set `includeConstraints: true` to read constraints) first. During testing, disabling or updating a subscription may be safer than deleting it.

### Completion Expectations

For code or artifact changes, report what changed, how it was verified, and any remaining risk. If required discovery cannot find a category, workflow, action, project, template, parameter, return type, package, or schema detail, stop and report the missing fact instead of filling the gap from memory.
