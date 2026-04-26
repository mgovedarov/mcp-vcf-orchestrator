# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

- **Build**: `npm run build` – compiles TypeScript to `dist/` and produces the executable at `dist/index.js`.
- **Start**: `npm start` – runs the server with `tsx src/index.ts` (requires runtime environment variables).
- **Inspect**: `npm run inspect` – launches the MCP Inspector for debugging the server.
- **Environment**: The server reads VCFA_HOST, VCFA_USERNAME, VCFA_ORGANIZATION, VCFA_PASSWORD, and optionally VCFA_IGNORE_TLS from the environment (see `.env.example`).

## Architecture Overview

The repository implements an MCP server that exposes VCF Automation Orchestrator (vRO), Service Broker, and Cloud Assembly REST API operations. Core modules:

1. **src/index.ts** – Entry point that registers MCP tools.
2. **src/vro-client.ts** – Handles communication with VMware VCF (REST API, session token management).
3. **src/tools/** – Directory containing individual tool implementations (workflow, action, deployment, catalog-item, subscription, template, configuration, event-topic).
4. **src/types.ts** – Shared TypeScript types and interfaces used across the server.
5. **dist/** – Compiled JavaScript output produced by `npm run build`.

Key architectural concepts:

- **MCP Server Model**: Tools are exposed as natural‑language commands (`list-workflows`, `create-action`, `run-workflow`, etc.). Each tool maps to a specific MCP endpoint.
- **Plugin‑Style Extensibility**: Extensibility points (actions, blueprint templates, configuration elements) are organized by category and can be discovered via `list-*` commands.
- **Configuration Management**: Settings are stored as configuration elements within the platform; the server treats them as first‑class data objects.
- **Event‑Driven Subscriptions**: The server can subscribe to VMware event topics (e.g., `compute.allocation.pre`) and trigger ABX or VRO workflows.

## Key Files for Navigation

- `src/index.ts` – Main server bootstrap and tool registration.
- `src/vro-client.ts` – Central client for VCF interactions.
- `src/tools/` – Individual tool implementations; filenames correspond to tool names.
- `package.json` – Scripts and dependencies; useful for understanding build and runtime commands.

## Development Workflow

1. Make code changes.
2. Run `npm run build` to compile.
3. Use `npm start` to run the server locally (ensure environment variables are set).
4. For debugging, launch `npm run inspect` to open the MCP Inspector in a browser.

No additional test framework is defined; verification is done via manual inspection or external test harnesses.