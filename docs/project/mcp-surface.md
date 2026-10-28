# MCP Surface

**Purpose:** how tools, resources, and prompts are registered and what shape their results take. Also how the confirmation guards and the secret withholding hold together across tools and resources.

## Key Files

| Path | Role |
| --- | --- |
| `src/tools/*-tools.ts` | Tool registration per domain |
| `src/tools/annotations.ts` | `DESTRUCTIVE_LIVE_WRITE` |
| `src/tools/confirmation-guards.ts` | `guardExpectedFields`, `guardExpectedStringList`, `guardExpectedCategory`, `appendGuardGuidance` |
| `src/tools/list-limit.ts`, `src/tools/truncation.ts` | `limit` schema and `limitNote`; `truncationNote` for page-capped lists |
| `src/tools/content-summary.ts` | `omittedContentSummary` for content that a `get-*` tool omits by default |
| `src/tools/parameter-values.ts` | Workflow parameter rendering, with `formatVroValueRedacted` |
| `src/resources/index.ts` | The `vcfa://` resources: docs, patterns, a schema, context snapshots, live objects |
| `src/resource-views.ts` | Reduces live records so that a resource withholds what its tool withholds |
| `src/prompts/index.ts` | The static `vcfa-*` prompts |
| `src/redaction.ts`, `src/content-metadata.ts` | Type-based and key-name-based withholding, and the sha256-plus-length stand-in |

## How It Works

### Tools

- Each module exports a `register…Tools(server, client)` function. Inside it, each tool is registered with `server.registerTool(name, config, handler)`. The config holds:
  - `title`;
  - `description`;
  - `inputSchema` as `z.object(...)`;
  - `annotations`.

  Read-only example: `registerCategoryTools` in `src/tools/category-tools.ts`.
- A handler wraps its work in `try`, and the `catch` returns a text result starting `Failed to …` with `isError: true`, as `list-categories` does.
- **List tools** that walk pages:
  - accept `limit` (`listLimitSchema` in `src/tools/list-limit.ts`) and append `limitNote`;
  - always append `truncationNote`, so a page-capped walk is never reported as complete (`truncationNote` in `src/tools/truncation.ts`).

  `list-workflow-executions` and `list-deployment-actions` read a single response, so they do neither. `list-workflow-executions` instead renders its own note when that response was capped by `maxResults` (`DEFAULT_EXECUTION_MAX_RESULTS` in `src/client/workflow-client.ts` is the default), and `list-workflows-by-category` renders its own category-limit note.
- **Get tools** omit bulky content by default and print `omittedContentSummary` (sha256 and length) along with the flag that returns it, such as `includeScript` or `includeContent`.

### Confirmation Flow For Mutations

1. Without `confirm: true`, the handler returns a plain instruction and does nothing. That result is not an error (`delete-template` in `src/tools/template-tools.ts`).
2. If any `expected*` argument is present, the handler reads the live target and compares. On a mismatch, `guardExpectedFields` in `src/tools/confirmation-guards.ts` returns `isError: true` with "No live mutation was performed".
3. Only then does the write run.
4. On success, `update-action` and the five direct import tools append the two-phase hint with `appendGuardGuidance`, whether or not guards were passed.

`update-configuration` runs steps 1 and 2 the other way round. It reads the live element before the `confirm` check, to carry its name and description forward, so a guard mismatch is an error there even when `confirm` is false (`update-configuration` in `src/tools/config-tools.ts`).

User-facing description: [Safety](../operations/safety.md#two-phase-target-confirmation).

### Annotations

- `{ readOnlyHint: true }` marks discovery tools.
- `{ readOnlyHint: false }` marks additive writes.
- `DESTRUCTIVE_LIVE_WRITE` marks anything that overwrites, deletes, executes, or provisions, including `create-deployment` by design (see the comment on `DESTRUCTIVE_LIVE_WRITE` in `src/tools/annotations.ts`).
- `test/tool-annotations.test.mjs` enforces the destructive set by name prefix. The categories are listed in the [Tool Reference](../reference/tools.md).

### Resources

- **Static resources** (docs, patterns, schema) use `server.registerResource(name, uri, meta, handler)`.
  - The two docs resources read `README.md` and `docs/vro-artifact-authoring.md` from the installed package (`README_URL` and `ARTIFACT_AUTHORING_URL` in `src/resources/index.ts`).
- **Live resources** use a `ResourceTemplate` with `list: undefined`. They fetch through the facade and pass the record through a view, as `vcfa-action` in `src/resources/index.ts` does.
- **Snapshot resources** validate the file name, resolve it inside the context directory, and refuse symbolic links (`readContextSnapshotResource` in `src/resources/index.ts`).
- Resource handlers throw on failure. There is no `isError` result for resources.
- **The withholding contract:** a resource withholds what its matching `get-*` tool withholds, and nothing more (the contract comment in `src/resource-views.ts`). Fields that a tool skips only for brevity are still served.

### Prompts

- `server.registerPrompt(name, { title, description, argsSchema }, callback)`, where `argsSchema` is a raw zod shape, not `z.object` (`registerVcfaPrompts` in `src/prompts/index.ts`).
- Prompts take no client and return fixed playbook text.

### Redaction

- **Typed values:** `isSecureAttributeValue` in `src/redaction.ts` checks the declared type and the value envelope. `formatVroValueRedacted` in `src/tools/parameter-values.ts` prints `[redacted]` for those values.
- **Untyped maps:** a key-name heuristic, `SENSITIVE_PROPERTY_KEY` in `src/redaction.ts`, is the weaker fallback.
- **Not covered:** neither check reaches inside an untyped composite, a log line, or exception text. The modules require every caller to say so in its description and docs.
- **Digests:** `contentMetadata` and `omittedContentSummary` hash the same input the same way, so the tool and resource digests match byte for byte (`contentMetadata` in `src/content-metadata.ts`).

## Extension Points

- **New tool:** follow the checklist in the Conventions section of `AGENTS.md`. Copy an existing tool's shape: a read-only list, a `confirm`-gated delete (`delete-template` in `src/tools/template-tools.ts`), or a guarded import (`import-workflow-file` in `src/tools/workflow-tools.ts`).
- **New live resource:** a `ResourceTemplate` plus a view in `src/resource-views.ts` whenever the matching tool withholds anything.
- **New prompt:** `registerPrompt` in `src/prompts/index.ts` and a heading in `docs/reference/resources-prompts.md`.

## Gotchas

- `scripts/validate-docs.mjs` parses the literal registration calls and the reference headings. A tool registered any other way, or documented under a different heading, fails `validate:docs`.
- A mismatch on the `confirm` flag is not an error, but a guard mismatch is. Tests and clients rely on that difference.
- Adding a withheld field to a `get-*` tool without updating the matching view in `src/resource-views.ts` reopens the bypass that VCFO-092 closed.
- Changing how content is hashed in one place breaks digest equality with the other.
- Source is cited by file and symbol, never by line number, and `validate:docs` checks every such citation. See the Gotchas section of `AGENTS.md`.
