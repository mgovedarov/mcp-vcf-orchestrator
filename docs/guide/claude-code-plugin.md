# Claude Code Plugin

This repository ships a [Claude Code](https://claude.ai/code) plugin that bundles
two **Skills** for working with the VCF Automation Orchestrator MCP server. The
skills auto-activate from natural intent and route you into the server's existing
`vcfa-*` prompts and tools, encoding the discovery-first, confirm-before-write
safety discipline so you do not have to remember tool or prompt names.

The plugin contains skills only. The MCP server itself is configured separately —
see [Installation](./installation.md) and [Configuration](./configuration.md) for the
required environment variables (`VCFA_HOST`, `VCFA_USERNAME`, `VCFA_ORGANIZATION`,
`VCFA_PASSWORD`).

## Skills

- **vcfa-authoring** — fires when you create, update, scaffold, refactor, review,
  promote, or import a vRO workflow, action, configuration element, resource
  element, or package, or publish reusable content through the project package.
  It drives the discovery → export → author → preflight → diff →
  prepare-promotion → confirm → import → verify lifecycle and the package-first
  publishing flow.
- **vcfa-operations** — fires when you run a workflow, troubleshoot a failed
  execution or a stuck deployment, explore catalog items and deployments, manage
  day-2 actions, create or review blueprint templates, work with extensibility
  subscriptions and event topics, or discover what an environment offers.

## Install

From a Claude Code session, add this repository as a marketplace and install the
plugin:

```text
/plugin marketplace add mgovedarov/mcp-vcf-orchestrator
/plugin install vcfa-orchestrator@mcp-vcf-orchestrator
```

Once installed, the skills activate automatically when your request matches their
triggers. They prefer the server-provided prompts and read-only discovery tools,
and they require explicit confirmation before any tool that mutates live VCFA or
vRO state.
