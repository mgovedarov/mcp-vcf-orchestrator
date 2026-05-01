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

## Documentation Map

- [Installation](./installation.md) covers npm and source setup.
- [Configuration](./configuration.md) documents environment variables and artifact directories.
- [Tool Reference](../reference/tools.md) groups all MCP tools by domain.
- [How-Tos](../how-tos/workflows.md) show end-to-end assistant workflows.
- [Artifact Lifecycle](../artifacts/lifecycle.md) explains export, preflight, diff, promotion, and import.
