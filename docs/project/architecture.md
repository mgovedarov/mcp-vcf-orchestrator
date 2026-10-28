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

1. Reads the server version from `package.json` (`SERVER_VERSION` in `src/index.ts`).
2. `main` reads and validates the environment:
   - Missing `VCFA_HOST`, `VCFA_USERNAME`, `VCFA_ORGANIZATION`, or `VCFA_PASSWORD` exits 1 (`missingRequiredEnv` in `src/index.ts`).
   - `VCFA_HOST` may carry a path. `VCFA_VRO_HOST` may not.
   - `VCFA_TARGET_PLATFORM` must be `vcfa`, `vcfa9.0`, `vcfa9.1`, or `vra8` (`normalizeTargetPlatform` in `src/index.ts`).
3. Builds `VroClient`. No network call happens yet; login is lazy (`ensureAuthenticated` in `src/client/core.ts`).
4. Creates the `McpServer` with its instructions. Then it calls every `register…Tools` function, then `registerVcfaResources`, then `registerVcfaPrompts`.
5. Registers the SIGINT and SIGTERM handlers **before** connecting. Each handler closes the server, then the client's dispatcher, then exits 0 (`shutdown` in `src/index.ts`).
6. Connects `StdioServerTransport`. A fatal error from `main` exits 1.

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
  - Prompts are static playbooks and take no client (`registerVcfaPrompts` in `src/prompts/index.ts`).

### Dependency Direction

- Tools import the client only as a type (`import type { VroClient } from "../vro-client.js"`), so every network call goes through the facade. Tools do import pure helpers from client modules, for example the preflight report formatter and `apiErrorStatus`.
- Client modules import only `../types.js` and `../content-metadata.js`. They never import tools, resources, or `redaction.ts`.
- `redaction.ts` depends on the configuration and parameter client modules. Tools and `resource-views.ts` use it.
- The context snapshot avoids a cycle by taking a structural client interface. The facade passes itself (`collectContextSnapshot` in `src/client/index.ts`).
- The only importer of `src/client/index.ts` is `src/vro-client.ts`.

### Runtime State

- Tokens and the negotiated API version live in memory on `VroHttpClient`.
- Files are written only by export, scaffold, and snapshot operations, always under the configured artifact directories. See [Configuration](../guide/configuration.md#artifact-directories).

## Extension Points

| To add | Touch |
| --- | --- |
| A tool in an existing domain | That domain's `src/tools/*-tools.ts`, plus `docs/reference/tools.md` and tests. Rules: the Conventions section of `AGENTS.md` |
| A new tool module | Its register call in `main` in `src/index.ts`. The full checklist is in the Conventions section of `AGENTS.md` |
| A client domain | A class over `VroHttpClient` (model: `src/client/template-client.ts`), a field and a constructor line on `VroClient` in `src/client/index.ts`, and delegating facade methods |
| An Automation service | The `AutomationService` type, the vRA 8 write-refusal map `UNSUPPORTED_AUTOMATION_WRITE`, and the base-URL map `automationBaseUrls`, all in `src/client/core.ts`. The maps are exhaustive on purpose, so each new service forces a write-support decision |
| A resource or prompt | `src/resources/index.ts` or `src/prompts/index.ts`, plus `docs/reference/resources-prompts.md` |

## Gotchas

- Startup makes no network call. A wrong password or an unreachable host shows up only on the first tool call (`ensureAuthenticated` in `src/client/core.ts`).
- `VCFA_ARTIFACT_DIR` defaults to `artifacts/` under the process working directory (`DEFAULT_ARTIFACT_DIR` in `src/index.ts`). The same server started from a different directory reads and writes a different artifact tree.
- `README.md` and `docs/vro-artifact-authoring.md` are read at runtime and served as `vcfa://docs/readme` and `vcfa://docs/artifact-authoring` (`README_URL` and `ARTIFACT_AUTHORING_URL` in `src/resources/index.ts`). Edits to them change what agents receive.
- Working gotchas such as test builds and signal-handler order are in the Gotchas section of `AGENTS.md`.
