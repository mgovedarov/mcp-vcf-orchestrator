---
name: vcfa-operations
description: >-
  Run and operate VCF Automation Orchestrator, Service Broker, and Cloud
  Assembly through the mcp-vcf-orchestrator MCP server. Use when the user wants
  to run a workflow, troubleshoot a failed workflow execution or a stuck
  deployment, explore catalog items and deployments, manage day-2 actions,
  create or review blueprint templates, work with extensibility subscriptions
  and event topics, or discover what an environment offers. Encodes
  read-only-first discovery and confirm-before-write safety, and routes to the
  matching vcfa-* prompts.
---

# VCFA Operations

Operate and troubleshoot VCF Automation through the MCP server. Start with
read-only discovery and only mutate after explicit confirmation. This skill
orchestrates the server's prompts, resources, and tools rather than replacing
them.

## Core principles

- Inspect before you act. Use the `list-*` and `get-*` tools and the execution
  log tools to understand state before remediating.
- The mutating tools — `run-workflow`, `run-workflow-and-wait`,
  `create-deployment`, `run-deployment-action`, `delete-deployment`,
  `create-template`, `delete-template`, `create-subscription`,
  `update-subscription`, `delete-subscription` — require a `confirm: true`
  argument plus real user confirmation of the exact target and expected impact.
- Running a workflow or a deployment day-2 action changes the live environment.
  Treat it like a production operation: confirm target, inputs, and blast radius.

## Prefer the server prompts

- `vcfa-troubleshoot-deployment` — inspect a deployment and its day-2 options
  before remediation.
- `vcfa-troubleshoot-workflow-execution` — diagnose a failed execution using
  logs, stack, and workflow source.
- `vcfa-discover-capabilities` — explore plugins, categories, workflows, actions,
  catalog items, deployments, templates, and subscriptions.
- `vcfa-collect-context-snapshot` — persist reusable environment context.
- `vcfa-create-template` and `vcfa-review-template` — discover conventions before
  drafting a blueprint, and review one for catalog readiness.
- `vcfa-integrate-workflow-template-subscription` — plan workflow, template,
  catalog, deployment, and subscription integration.

## Tool map by task

- Execution: `run-workflow`, `run-workflow-and-wait`, `get-workflow-execution`,
  `get-workflow-execution-logs`, `list-workflow-executions`.
- Deployments: `list-deployments`, `get-deployment`, `list-deployment-actions`,
  `run-deployment-action`, `create-deployment`, `delete-deployment`.
- Catalog: `list-catalog-items`, `get-catalog-item`.
- Templates: `list-templates`, `get-template`, `create-template`,
  `delete-template`.
- Subscriptions and events: `list-event-topics`, `list-subscriptions`,
  `get-subscription`, `create-subscription`, `update-subscription`,
  `delete-subscription`.
- Discovery support: `list-workflows`, `list-actions`, `list-categories`,
  `list-plugins`.

Live objects are also available as read-only resources, e.g.
`vcfa://deployments/{id}`, `vcfa://workflows/{id}`, and `vcfa://subscriptions/{id}`.

## vra8 mode caveat

When the server runs with `VCFA_TARGET_PLATFORM=vra8` (vRA/vRO 8.12+ Basic auth),
only vRO read operations plus workflow execution and execution logs are
supported. Automation-service surfaces — catalog, deployments, templates,
subscriptions, and event topics — are intentionally unsupported in that mode.
