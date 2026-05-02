---
name: VCF Orchestrator Agent
description: Provides AI-driven interactions with VCF Automation Orchestrator (vRO) via the MCP server
trigger: "vcfa-orchestrator"
---

# VCF Orchestrator Agent

This custom agent is designed to assist with managing VCF Automation Orchestrator workflows, workflow executions, actions, configurations, resource elements, subscriptions, catalog items, deployments, templates, packages, and plugins via natural language commands. It loads the MCP server tools automatically and exposes commands like \`list-workflows\`, \`create-workflow\`, \`run-workflow\`, \`run-workflow-and-wait\`, \`list-workflow-executions\`, \`list-deployments\`, and related artifact import/export commands.

## When to Use

- When you need to list, create, or manage VCF Automation artifacts
- When you need to inspect workflow definitions and parameters
- When you need to execute workflows with input parameters
- When you need to inspect workflow execution history, status, and outputs
- When you need to manage deployments and blueprint templates
- When you need to export or import real vRO workflow, action, configuration, package, or resource artifacts
- When authoring or importing real vRO workflow/action artifacts, first read `docs/vro-artifact-authoring.md`

## Commands

- Workflows: \`list-workflows\`, \`get-workflow\`, \`create-workflow\`, \`run-workflow\`, \`run-workflow-and-wait\`, \`list-workflow-executions\`, \`get-workflow-execution\`, \`export-workflow-file\`, \`import-workflow-file\`, \`delete-workflow\`
- Actions: \`list-actions\`, \`get-action\`, \`create-action\`, \`export-action-file\`, \`import-action-file\`, \`delete-action\`
- Configuration elements: \`list-configurations\`, \`get-configuration\`, \`create-configuration\`, \`update-configuration\`, \`export-configuration-file\`, \`import-configuration-file\`, \`delete-configuration\`
- Resource elements: \`list-resource-elements\`, \`export-resource-element\`, \`import-resource-element\`, \`update-resource-element\`, \`delete-resource-element\`
- Categories: \`list-categories\`
- Subscriptions: \`list-event-topics\`, \`list-subscriptions\`, \`get-subscription\`, \`create-subscription\`, \`update-subscription\`, \`delete-subscription\`
- Catalog items: \`list-catalog-items\`, \`get-catalog-item\`
- Deployments: \`list-deployments\`, \`get-deployment\`, \`create-deployment\`, \`list-deployment-actions\`, \`run-deployment-action\`, \`delete-deployment\`
- Templates: \`list-templates\`, \`get-template\`, \`create-template\`, \`delete-template\`
- Packages: \`list-packages\`, \`get-package\`, \`export-package\`, \`import-package\`, \`delete-package\`
- Plugins: \`list-plugins\`
- Promotion: \`prepare-artifact-promotion\`

GitHub issue code convention:
- Use `VCFO-###` for repo issue codes, starting at `VCFO-001` and incrementing sequentially.
- Prefix issue titles with the code, for example `[VCFO-001] Expand MCP resources and prompts for workflow/template implementation`.

This agent can be invoked by describing the desired operation in natural language; the agent will map it to the appropriate MCP tool calls.
