# Architecture

**Purpose:** the server's layers, how it starts, which way the modules depend on each other, and where new capability plugs in.

## Key Files

| Path | Role |
| --- | --- |
| `src/index.ts` | Entry point and `bin`: reads env, builds `VroClient`, registers tools, resources, and prompts, connects stdio |
| `src/client/core.ts` | `VroHttpClient`: auth, HTTP, error building, platform gating |
| `src/client/index.ts` | `VroClient` facade composing the per-domain clients |
| `src/client/*-client.ts` | One class per domain: workflow, action, configuration, category, subscription, catalog, deployment, template, package, resource, plugin, project |
| `src/tools/*-tools.ts` | One `register…Tools` function per domain |
| `src/resources/index.ts`, `src/prompts/index.ts` | Discovery layer: `vcfa://` resources and `vcfa-*` prompts |
| `src/redaction.ts`, `src/resource-views.ts`, `src/content-metadata.ts` | Secret withholding shared by tools and resources |
| `src/types.ts` | Shared types such as `VroTargetPlatform` and `VroClientConfig` |
| `src/vro-client.ts` | One-line shim re-exporting `VroClient` for the public import path |
| `src/context-directory.ts` | Resolves where context snapshots are written |

## How It Works

### Startup (`src/index.ts`)

1. Reads the server version from `package.json` (`src/index.ts:27-30`).
2. `main()` reads and validates the environment (`src/index.ts:106-128`):
   - Missing `VCFA_HOST`, `VCFA_USERNAME`, `VCFA_ORGANIZATION`, or `VCFA_PASSWORD` exits 1 (`src/index.ts:35-45`).
   - `VCFA_HOST` may carry a path. `VCFA_VRO_HOST` may not.
   - `VCFA_TARGET_PLATFORM` must be `vcfa`, `vcfa9.0`, `vcfa9.1`, or `vra8` (`src/index.ts:246-257`).
3. Builds `VroClient`. No network call happens yet; login is lazy (`src/client/core.ts:788-805`).
4. Creates the `McpServer` with its instructions. Then it calls the 14 `register…Tools` functions, then `registerVcfaResources`, then `registerVcfaPrompts` (`src/index.ts:199-214`).
5. Registers the SIGINT and SIGTERM handlers **before** connecting. Each handler closes the server, then the client's dispatcher, then exits 0 (`src/index.ts:216-238`).
6. Connects `StdioServerTransport` (`src/index.ts:240-243`). A fatal error exits 1 (`src/index.ts:259-262`).

### Layers

- **Client** (`src/client/`) owns everything that touches the network or artifact files:
  - `core.ts` holds auth, the token, HTTP, and error text.
  - The domain clients hold endpoint paths and response parsing.
  - The helpers cover pagination, filtering, parameters, attribute links, path safety, artifact preflight, `.workflow` building, and context snapshots.
  - See [Client Layer](./client-layer.md).
- **Tools** (`src/tools/`) map named MCP tools onto facade calls. They own:
  - argument schemas;
  - confirmation and target guards;
  - annotations;
  - result text and redaction.

  See [MCP Surface](./mcp-surface.md).
- **Discovery:**
  - Resources serve docs, patterns, snapshots, and live objects. Live objects are fetched through the facade and reduced by `resource-views.ts`.
  - Prompts are static playbooks and take no client (`src/prompts/index.ts:34`).

### Dependency Direction

- Tools import the client only as a type (`import type { VroClient } from "../vro-client.js"`), so every network call goes through the facade. Tools do import pure helpers from client modules, for example the preflight report formatter and `apiErrorStatus`.
- Client modules import only `../types.js` and `../content-metadata.js`. They never import tools, resources, or `redaction.ts`.
- `redaction.ts` depends on the configuration and parameter client modules. Tools and `resource-views.ts` use it.
- The context snapshot avoids a cycle by taking a structural client interface. The facade passes itself (`src/client/index.ts:481-484`).
- The only importer of `src/client/index.ts` is `src/vro-client.ts`.

### Runtime State

- Tokens and the negotiated API version live in memory on `VroHttpClient`.
- Files are written only by export, scaffold, and snapshot operations, always under the configured artifact directories. See [Configuration](../guide/configuration.md#artifact-directories).

## Extension Points

| To add | Touch |
| --- | --- |
| A tool in an existing domain | That domain's `src/tools/*-tools.ts`, plus `docs/reference/tools.md` and tests. Rules: the Conventions section of `AGENTS.md` |
| A new tool module | `src/index.ts:199-212`. The full checklist is in the Conventions section of `AGENTS.md` |
| A client domain | A class over `VroHttpClient` (model: `src/client/template-client.ts`), a field and constructor line in `src/client/index.ts:80-110`, and delegating facade methods |
| An Automation service | The `AutomationService` type, the vRA 8 write-refusal map, and the base-URL map in `src/client/core.ts:17-49,733-746`. The maps are exhaustive on purpose, so each new service forces a write-support decision |
| A resource or prompt | `src/resources/index.ts` or `src/prompts/index.ts`, plus `docs/reference/resources-prompts.md` |

## Gotchas

- Startup makes no network call. A wrong password or an unreachable host shows up only on the first tool call (`src/client/core.ts:788-805`).
- `VCFA_ARTIFACT_DIR` defaults to `artifacts/` under the process working directory (`src/index.ts:32,118`). The same server started from a different directory reads and writes a different artifact tree.
- `README.md` and `docs/vro-artifact-authoring.md` are read at runtime and served as `vcfa://docs/readme` and `vcfa://docs/artifact-authoring` (`src/resources/index.ts:21-25`). Edits to them change what agents receive.
- Working gotchas such as test builds and signal-handler order are in the Gotchas section of `AGENTS.md`.
