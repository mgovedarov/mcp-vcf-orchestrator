# Overview

`@mgovedarov/mcp-vcf-orchestrator` is an MCP server for VCF Automation Orchestrator, Service Broker, and Cloud Assembly operations. It exposes tools that let an AI assistant inspect and manage workflows, actions, configuration elements, resource elements, packages, templates, catalog items, deployments, subscriptions, categories, and plugins.

The server supports VCF 9 Automation and Aria Automation 8.x environments with REST API access.

## What It Helps With

- Discover existing automation assets before implementing new workflows or templates.
- Run workflows with validated inputs and useful execution diagnostics.
- Export, scaffold, preflight, diff, and import vRO workflow/action/configuration/package artifacts.
- Browse catalog items, create deployments, and discover day-2 actions.
- Manage extensibility subscriptions that connect event topics to workflows or ABX actions.
- Collect practical context through MCP resources and prompts so agents avoid inventing environment-specific details.

## Operating Model

The safest workflow is discovery first:

1. Use read-only list/get tools to find the current asset, category, project, or schema.
2. Generate or edit local artifacts under configured artifact directories.
3. Run preflight and diff tools before importing.
4. Require explicit confirmation for destructive or live write operations.
5. Verify changes with list/get/run tools after the operation completes.

## Starting A New VCFA Project

When starting in a new VCFA or vRO environment, use the server to map current state before drafting new automation:

1. Configure `VCFA_HOST`, `VCFA_USERNAME`, `VCFA_ORGANIZATION`, and `VCFA_PASSWORD`. Artifacts are written to `artifacts/` in the MCP server process working directory by default, typically the open project; set `VCFA_ARTIFACT_DIR` to override.
2. Verify access with read-only discovery: `list-plugins`, `list-categories`, `list-workflows`, `list-actions`, `list-templates`, `list-catalog-items`, `list-event-topics`, and `list-subscriptions`.
3. Inspect reusable candidates with `get-workflow`, `get-action`, `get-template`, or `get-catalog-item` before designing a replacement.
4. Read the relevant MCP resources, especially `vcfa://docs/artifact-authoring`, `vcfa://schemas/workflow-scaffold`, and the matching `vcfa://patterns/*` resource.
5. Export existing assets before changing them. Then scaffold or edit local artifacts, run preflight and diff tools, and import only after explicit confirmation.

Use the built-in MCP prompts when the assistant should follow a known workflow rather than free-form instructions. For example, use `vcfa-discover-capabilities` to inventory an unfamiliar environment conversationally, `vcfa-collect-context-snapshot` to persist reusable Markdown/JSON inventory with `collect-context-snapshot`, `vcfa-discovery-first-implementation-plan` to plan a change, `vcfa-build-workflow-from-action` to wrap a verified action, and `vcfa-review-artifact-import` before importing a local artifact. When you specifically need VMware baseline context, use `vcfa-collect-context-snapshot` with `profile: vcfaBuiltIns` to focus the snapshot on workflows in subfolders below `Library` and actions in `com.vmware` modules. See [Resources And Prompts](../reference/resources-prompts.md) for prompt arguments and examples.

## Documentation Map

- [Installation](./installation.md) covers npm and source setup.
- [Configuration](./configuration.md) documents environment variables and artifact directories.
- [Tool Reference](../reference/tools.md) groups all MCP tools by domain.
- [How-Tos](../how-tos/workflows.md) show end-to-end assistant workflows.
- [Artifact Lifecycle](../artifacts/lifecycle.md) explains export, preflight, diff, promotion, and import.
