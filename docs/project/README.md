# Project Internals

How the server is built, for contributors and coding agents. The working rules (commands, conventions, Git/PR rules) live in [`AGENTS.md`](https://github.com/mgovedarov/mcp-vcf-orchestrator/blob/main/AGENTS.md). Setup and the tool reference are in the [Guide](../guide/overview.md) and the [Tool Reference](../reference/tools.md).

## What The System Does

A Node.js MCP server that an MCP client starts as a child process and talks to over stdio. It logs in to VCF Automation (or vRA 8) and maps its MCP tools, resources, and prompts onto REST calls against vRO (`/vco/api`) and the Automation services: catalog, deployment, blueprint, project, and event broker. The [Tool Reference](../reference/tools.md) and [Resources and Prompts](../reference/resources-prompts.md) list them, and `validate:docs` keeps those lists in step with the code. Exported and authored artifacts live as local files under the configured artifact directories. There is no database.

## Components

```text
MCP client ──stdio──> src/index.ts (env, VroClient, register*, StdioServerTransport)
                          │
       ┌──────────────────┼────────────────────────┐
  src/tools/*.ts    src/resources/index.ts    src/prompts/index.ts
  (MCP tools)       (vcfa:// URIs)            (static vcfa-* playbooks)
       └────────┬─────────┘
                ▼
  src/client/index.ts   VroClient facade, one *-client.ts per domain
                ▼
  src/client/core.ts    VroHttpClient: login, token refresh, undici fetch, errors
       │                                        │
  VCFA_HOST: login, /api/versions,          VCFA_VRO_HOST (or VCFA_HOST): /vco/api
  catalog, deployment, blueprint, project,  local artifact directories (files.ts)
  event broker
```

## Request Flow

1. The MCP client calls a tool. The SDK validates the arguments against the tool's zod `inputSchema`.
2. The handler in `src/tools/` checks the `confirm` flag and any `expected*` guards before a mutation, reading live metadata through the facade first.
3. The `VroClient` facade delegates to a domain client, which calls `VroHttpClient` (`get`, `post`, `put`, `del`, or `authenticatedFetch` for binary content).
4. `src/client/core.ts` logs in lazily and shares one in-flight login across requests. It sends the bearer token, re-authenticates once on a `401`, and turns an error response into a `vRO API error` with a status and a hint.
5. The handler returns a text result, with withheld or redacted content where needed, or `isError: true` with the failure message.

## Pages

| Page | Covers |
| --- | --- |
| [Architecture](./architecture.md) | Layers, startup sequence, dependency direction, extension points |
| [Client Layer](./client-layer.md) | Platform targets and login, hosts and base URLs, HTTP, errors and hints, artifact file safety |
| [MCP Surface](./mcp-surface.md) | Tool registration, confirmation guards, annotations, results, resources, prompts, redaction |
| [Glossary](./glossary.md) | VCF Automation, vRO, and repository terms |
| [Agent Workflow](./agent-workflow.md) | The `/issue` and `/process-issues` commands and the subagents behind them |

Related pages that these pages link to rather than repeat: [Configuration](../guide/configuration.md), [Safety](../operations/safety.md), [Contributing](../operations/contributing.md), [Troubleshooting](../operations/troubleshooting.md), [Artifact Lifecycle](../artifacts/lifecycle.md).
