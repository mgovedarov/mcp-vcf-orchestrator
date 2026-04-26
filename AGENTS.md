---
name: VCF Orchestrator Agent
description: Provides AI-driven interactions with VCF Automation Orchestrator (vRO) via the MCP server
trigger: "vcfa-orchestrator"
---

# VCF Orchestrator Agent

This custom agent is designed to assist with managing VCF Automation Orchestrator workflows, actions, configurations, subscriptions, catalog items, deployments, and templates via natural language commands. It loads the MCP server tools automatically and exposes commands like \`list-workflows\`, \`create-workflow\`, \`run-workflow\`, etc.

## When to Use

- When you need to list, create, or manage VCF Automation artifacts
- When you need to inspect workflow definitions and parameters
- When you need to execute workflows with input parameters
- When you need to manage deployments and blueprint templates

## Commands

- \`list-workflows\` – list workflows, optionally filter   - *Prompt*: see `.github/prompts/vcfa-list-workflows.prompt.md` for trigger phrase details- \`get-workflow\` – retrieve workflow details
- \`create-workflow\` – create a new workflow
- \`run-workflow\` – execute a workflow with inputs
- \`get-workflow-execution\` – check execution status
- \`delete-workflow\` – remove a workflow
- (and other similar commands from the MCP server)

This agent can be invoked by describing the desired operation in natural language; the agent will map it to the appropriate MCP tool calls.