# Changelog

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

