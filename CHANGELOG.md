# Changelog

## 2.2.1 - 2026-06-14

This release completes and hardens scaffolded-workflow support so generated `.workflow` artifacts import, open in the editor, and run in live vRO 9.1, and lets the scaffolder emit native vRO action workflow items.

### Added

- `scaffold-workflow-file` can emit **native vRO action workflow items** via an optional `kind: "action"` task discriminator (`module`, `actionName`, ordered `inputs`, `resultBinding`), generating the `actionResult = System.getModule("<module>").<actionName>(...)` script and a `type="task" script-module="<module>/<actionName>"` item; void actions omit `resultBinding` and emit a bare call. Tasks without `kind` behave exactly as before. `preflight-workflow-file` validates the `<module>/<actionName>` form and `diff-workflow-file` surfaces native-action item changes (VCFO-046, VCFO-059).

### Fixed

- Scaffolded `.workflow` artifacts now **import, open in the VCF 9.x Orchestrate editor, and run** in live vRO 9.1. The builder emits `workflow-info` as a Java properties file (not XML), encodes `workflow-content` as UTF-16BE with a `UTF-8` XML declaration (the BOM drives decoding; the v2 editor returns 500 on a declaration saying `UTF-16`), chains an explicit terminal `<workflow-item type="end">` (replacing `end-mode="1"` on the last task), writes `input_form_` only when the workflow has inputs, drops the read-only `allowed-operations` marker that made the editor refuse to open the workflow, and gives every item a distinct `<position>` with bare `<param>` elements (VCFO-060).
- `preflight-workflow-file` and `diff-workflow-file` now parse vRO's native repeated `<attrib name type read-only>` attribute shape (not just the scaffold's wrapped form), so scaffolds and real exports round-trip identically; binding type-match tolerates vRO's generic `Any`; and preflight parses `workflow-info` as properties, requires UTF-16BE content, and rejects the legacy `end-mode="1"` pattern (VCFO-061).

## 2.2.0 - 2026-06-12

This release adds VCF Automation 9.1 support with automatic API version negotiation, provider/system administrator logins, and fixes workflow and configuration parameter payloads to use the canonical vRO type keys the REST API expects.

### Added

- VCF Automation 9.1 support: the default `vcfa` platform now auto-negotiates the VCF Cloud API version before authenticating, probing the unauthenticated `GET /api/versions` discovery document and preferring `9.1.0` over `9.0.0`. A probe that fails outright falls back to `9.0.0` for that attempt only and discovery is retried on the next authentication; a probe that succeeds but advertises no known version caches the `9.0.0` fallback. Authentication is single-flighted, so concurrent requests share one probe and one session login. New `VCFA_TARGET_PLATFORM` values `vcfa9.1` and `vcfa9.0` pin the version explicitly and skip the probe (VCFO-057).
- Provider/system administrator logins: `VCFA_ORGANIZATION=system` (case-insensitive) now routes authentication to `/cloudapi/1.0.0/sessions/provider`; the tenant `/sessions` endpoint rejects provider accounts with 401. Login 401 errors now include a hint distinguishing organization names from display names and pointing provider accounts at `VCFA_ORGANIZATION=system` (VCFO-057).

### Fixed

- Workflow execution and configuration attribute payloads now key parameter values by the canonical lowercase/hyphenated vRO type literal (`secure-string`, `date`, `mime-attachment`, …) instead of the display type from the definition (`SecureString`), which the vRO REST API rejects with a 400. `Array/<type>` inputs are serialized as `{"array": {"elements": [...]}}`, SDK object types (e.g. `VC:VirtualMachine`) as `{"sdk-object": {"id", "type"}}`, and plain-object `Properties` values as `{"properties": {"property": [...]}}` (VCFO-058).
- `run-workflow` and `run-workflow-and-wait` input validation now rejects non-string values for `SecureString` and `EncryptedString` inputs instead of forwarding them to the vRO API (VCFO-058).

## 2.1.0 - 2026-06-12

This release scopes TLS relaxation to the client's own requests, hardens response parsing and artifact preflight, gates bulky tool output behind opt-in flags, adds two-phase confirmation fields for live mutations, and ships a Claude Code plugin with authoring and operations skills.

### Security

- `VCFA_IGNORE_TLS=true` no longer disables TLS certificate verification process-wide via `NODE_TLS_REJECT_UNAUTHORIZED`. TLS relaxation is now scoped to the client's own requests to the configured VCFA host through a dedicated HTTPS agent, so other HTTPS traffic in the same Node process keeps full certificate verification. The minimum supported Node.js version is now 18.17.
- `get-configuration` now redacts `SecureString` attribute values instead of returning them in plain text (VCFO-048).

### Added

- Added a Claude Code plugin (`vcfa-orchestrator`) and marketplace manifest under `.claude-plugin/`, bundling two skills in `skills/`: `vcfa-authoring` (discovery-first artifact lifecycle and package-first publishing) and `vcfa-operations` (running workflows and guided troubleshooting). The skills delegate to the server's existing `vcfa-*` prompts, resources, and tools rather than duplicating them, and `npm run validate:docs` now drift-checks the tool/prompt/resource names they reference.
- Added `VroClient.close()` to release the client's network resources (the TLS-relaxed dispatcher); the server now calls it during graceful shutdown.
- Added a local TLS integration test that runs the client against a self-signed HTTPS server, verifying `ignoreTls` completes a real handshake (and that strict mode still rejects) without touching `NODE_TLS_REJECT_UNAUTHORIZED`.
- Added optional two-phase confirmation fields to high-risk live mutation tools: when expected target fields such as `expectedName`, `expectedCategoryId`/`expectedCategoryName`, `expectedPackageName`, `expectedWorkflowName`/`expectedInputNames`, or `expectedDeploymentName`/`expectedActionName` are supplied, the handler performs read-only discovery first and refuses to mutate if the live target does not match. Omitted fields keep existing `confirm: true` behavior unchanged.
- Workflow tools now return `structuredContent` (structured workflow, execution, and execution-log shapes) alongside their text output.

### Changed

- `get-template`, `get-action`, and `get-subscription` now summarize bulky content (blueprint YAML, action script, constraints JSON) as a sha256 + length line by default, consistent with context-snapshot redaction; the new `includeContent`, `includeScript`, and `includeConstraints` flags restore the full output (VCFO-055).
- Tools that overwrite or delete live state — import, update, run, and delete tools, plus `rebuild-project-package` — now advertise `destructiveHint: true` in their MCP annotations so hosts can require heightened approval; additive creates and `add-*-to-project-package` tools do not (VCFO-051).

### Fixed

- `run-workflow` now validates and type-normalizes caller-supplied inputs through the same shared preamble as `run-workflow-and-wait` instead of POSTing them to the live workflow unvalidated; the two handlers' drifted input schemas (`inputs[].type` required in one, optional in the other) are reconciled (VCFO-047).
- Query parameter values containing `$` or `~` are no longer un-encoded by the pagination query serializer; the literal-`$` exemption now applies only to OData system query keys such as `$filter` and `$search` (VCFO-050).
- Empty-body 2xx responses with a `Location` header no longer masquerade as a running workflow execution for non-execution endpoints; the synthetic `{ id, state: "running" }` shape is now scoped to the explicit workflow-execution start path (`startExecution`), and generic empty 2xx responses return `{}` (VCFO-052).
- A 2xx response with a non-JSON body (for example an HTML error page from a load balancer or SSO interstitial) now throws a sanitized, contextualized error naming the method, path, and correlation ID instead of a bare `SyntaxError: Unexpected token` (VCFO-053).
- List results that stop at the pagination request cap now carry a `truncated` flag instead of silently returning partial data with the server's full total; list tools append a visible truncation warning and context snapshots record a per-domain warning (VCFO-054).
- Artifact preflight now rejects `input_form_` entries that are not UTF-16BE (the documented contract) instead of silently accepting UTF-16LE, decodes UTF-16 entries fatally so corrupt bytes fail instead of passing as U+FFFD mojibake, and reports XML-looking `.action`/`.vsoconf` archive entries with invalid byte sequences instead of skipping them (VCFO-056).

## 2.0.0 - 2026-05-18

This release tightens live-operation safety, improves authentication and error handling, refreshes dependencies and documentation, and adopts Apache License 2.0 with NOTICE attribution.

### Breaking Changes

- Existing live mutation and workflow execution tool calls now require `confirm: true`.
  - Affected tools include workflow creation/execution, action creation, configuration creation/update, deployment creation, template creation, subscription creation/update, and other live import/delete operations that mutate VCFA/vRO state.
  - Calls without `confirm: true` now return a confirmation message instead of changing live state.

### Added

- Added automatic VCFA bearer-token refresh on 401/403 responses so expired sessions can recover without restarting the MCP server.
- Added redaction and truncation for surfaced VCFA/vRO error response bodies, while preserving safe diagnostic fields and correlation IDs.
- Added package validation coverage for published `LICENSE` and `NOTICE` files.

### Changed

- Adopted Apache License 2.0 for future releases, added NOTICE attribution, and clarified official package and repository branding.
- Changed local artifact export/snapshot/scaffold tools to advertise write-capable MCP annotations instead of read-only annotations.
- Synced the advertised MCP server version with the package version.
- Updated npm and GitHub Actions Dependabot checks to run monthly.
- Added npm package references to the README and installation guide.
- Refreshed production and development dependencies through Dependabot.

### Fixed

- Fixed action lookup fallback behavior so non-404 API failures are not silently ignored.
- Fixed duplicate vRA8 compatibility guard calls in artifact import/export paths.
- Fixed OData filter escaping in subscription lookups.

## 1.1.0 - 2026-05-13

This release expands the MCP server from a VCFA-only operations helper into a broader vRO automation toolkit, including vRA/vRO 8 read/run compatibility, package-first publishing workflows, richer artifact validation, and more discovery-oriented prompts and resources.

### Added

- Added `VCFA_TARGET_PLATFORM=vra8` mode for vRA/vRO 8.12+ environments that use Basic authentication against `/vco/api`.
  - Supports read operations for vRO resources plus workflow execution and execution log retrieval.
  - Rejects unsupported vRO writes in vRA8 mode with explicit compatibility errors.
  - Rejects Automation-service APIs in vRA8 mode, including catalog, deployments, templates, subscriptions, and event topics.
- Added workflow execution log support.
  - New `get-workflow-execution-logs` tool retrieves workflow execution logs.
  - Supports inline log formatting plus JSON and text export under the configured execution log artifact directory.
  - Supports minimum log levels and normalizes multiple vRO log response shapes.
- Added recursive workflow category discovery.
  - New `list-workflows-by-category` tool lists workflows under a workflow category tree.
  - Supports category selection by exact `categoryId`, `categoryName`, or `categoryPath`.
  - Supports empty category inclusion and category traversal limits.
- Added category-scoped configuration discovery.
  - `list-configurations` now accepts an optional `categoryId`.
  - Category-scoped listing reads category relations, returns only `ConfigurationElement` entries, and preserves name filtering.
- Added package-first vRO publishing support.
  - New project package workflow supports ensuring the configured project package, adding workflows, actions, configurations, and resources, rebuilding, exporting, inspecting import details, and importing the project package.
  - Package import details and package preflight flows make promotion reviewable before live import.
  - Package operations consistently reuse `VCFA_PROJECT_PACKAGE_NAME` instead of creating ad hoc packages.
- Added package and artifact validation tooling.
  - New package validation script checks package contents.
  - Documentation validation now checks reference drift, local Markdown links, documented tool names, prompt names, and top-level example arguments.
  - CI now includes package validation and documentation build coverage.
- Added richer MCP prompts for discovery-first implementation and troubleshooting workflows.
  - New and expanded prompts cover capability discovery, context snapshots, workflow authoring, workflow-from-action wrappers, workflow refactors, artifact import review, template review/creation, template/subscription integration, deployment troubleshooting, and workflow execution troubleshooting.
- Added MCP resources and reusable patterns.
  - Added workflow scaffold schema and workflow/template/subscription pattern resources.
  - Added persisted context snapshot resources, including `vcfa://context/latest` and named snapshot access.
  - Added dynamic resources for actions, configurations, deployments, packages, resource elements, subscriptions, and workflows.
- Added checked examples for artifact promotion, workflow artifacts, project package publishing, template/catalog/subscription workflows, and workflow execution log exports.
- Added or expanded documentation for artifact lifecycle, workflow authoring, configuration/resources, troubleshooting, safety, installation/configuration, and MCP client setup.

### Changed

- Improved workflow artifact generation and preflight validation.
  - Workflow artifacts now include stronger parameter, binding, input form, action reference, and archive safety validation.
  - Workflow authoring guidance now emphasizes importable `.workflow` artifacts, horizontal layout, safe input forms, and native action item caveats.
- Improved action, configuration, resource, package, and workflow clients to parse additional vRO attribute shapes and preserve more useful metadata.
- Improved context snapshots with safer redaction, deterministic Markdown/JSON output, optional domain coverage, and VMware built-in profiling.
- Improved README, AGENTS, CLAUDE, reference docs, examples, and how-tos to reflect the current tool surface and release workflows.
- Improved CI to test across supported Node.js versions and run the full validation gate on Node 24.
- Updated package dependencies and development dependencies through Dependabot.

### Fixed

- Fixed stale tool/documentation drift around configuration listing and category-scoped configuration discovery.
- Fixed several artifact path-safety and symlink handling cases in workflow, action, configuration, resource, package, and context operations.
- Fixed documentation/example drift detection so stale tool names and arguments fail validation before release.

### Compatibility Notes

- Existing VCFA behavior remains the default. Deployments without `VCFA_TARGET_PLATFORM` continue to use VCFA Cloud API session authentication.
- `VCFA_TARGET_PLATFORM=vra8` is intentionally limited to vRO `/vco/api` read operations plus workflow execution and execution logs. Automation-service APIs remain unsupported in this mode until token-auth support is added.
- Live create, update, import, delete, deployment, day-2, package, template, and subscription operations still require explicit confirmation in their tool inputs and should be preceded by read-only discovery.

## 1.0.1 - 2026-05-04

This patch release focused on improving reusable discovery context, tightening documentation accuracy, and making local artifact defaults clearer after the initial `1.0.0` release.

### Added

- Added richer context snapshot handling for reusable environment discovery.
  - Added persisted context snapshot resources, including latest snapshot lookup and named snapshot access.
  - Added safer context directory resolution so snapshots default to the MCP client's workspace when available.
  - Added tests covering default context locations, persisted snapshot reads, missing snapshot behavior, and unsafe snapshot file names.
- Added the `vcfaBuiltIns` context snapshot profile.
  - Filters VMware built-in workflows and actions for baseline discovery.
  - Helps agents distinguish reusable platform content from project-specific custom content.
  - Expanded prompt guidance to use the profile when VMware built-in context is useful.
- Added prompt examples for reusable workflow discovery and context persistence.
- Added more detailed tool and prompt parameter documentation in the reference pages.

### Changed

- Clarified default artifact directory behavior across README, configuration docs, and reference docs.
  - `VCFA_ARTIFACT_DIR` defaults are described as `artifacts/` under the MCP server process working directory.
  - Context snapshots document their preference for the MCP client's current workspace root.
- Improved action discovery metadata parsing by accepting additional action ID attribute shapes.
- Collapsed and clarified long tool and prompt parameter sections in the documentation.
- Removed obsolete standalone prompt files now covered by registered MCP prompts.
- Added package overrides for `esbuild` and `vite`.

### Fixed

- Fixed context snapshot redaction and resource handling edge cases.
- Fixed documentation drift around `collect-context-snapshot` parameters and usage.
- Fixed stale artifact directory references that still pointed at older default paths.
