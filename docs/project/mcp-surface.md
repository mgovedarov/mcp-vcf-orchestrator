# MCP Surface

**Purpose:** how tools, resources, and prompts are registered and what shape their results take. Also how the confirmation guards and the secret withholding hold together across tools and resources.

## Key Files

| Path | Role |
| --- | --- |
| `src/tools/*-tools.ts` | Tool registration per domain (80 tools) |
| `src/tools/annotations.ts` | `DESTRUCTIVE_LIVE_WRITE` (`src/tools/annotations.ts:18-21`) |
| `src/tools/confirmation-guards.ts` | `guardExpectedFields`, `guardExpectedStringList`, `guardExpectedCategory`, `appendGuardGuidance` |
| `src/tools/list-limit.ts`, `src/tools/truncation.ts` | `limit` schema and `limitNote`; `truncationNote` for page-capped lists |
| `src/tools/content-summary.ts` | `omittedContentSummary` for content that a `get-*` tool omits by default |
| `src/tools/parameter-values.ts` | Workflow parameter rendering, with `formatVroValueRedacted` |
| `src/resources/index.ts` | 18 `vcfa://` resources: docs, patterns, a schema, context snapshots, live objects |
| `src/resource-views.ts` | Reduces live records so that a resource withholds what its tool withholds |
| `src/prompts/index.ts` | 12 static `vcfa-*` prompts |
| `src/redaction.ts`, `src/content-metadata.ts` | Type-based and key-name-based withholding, and the sha256-plus-length stand-in |

## How It Works

### Tools

- Each module exports a `register…Tools(server, client)` function. Inside it, each tool is registered with `server.registerTool(name, config, handler)`. The config holds:
  - `title`;
  - `description`;
  - `inputSchema` as `z.object(...)`;
  - `annotations`.

  Read-only example: `src/tools/category-tools.ts:8-69`.
- A handler wraps its work in `try`, and the `catch` returns a text result starting `Failed to …` with `isError: true` (`src/tools/category-tools.ts:56-66`).
- **List tools:**
  - accept `limit` (`src/tools/list-limit.ts:5-13`) and append `limitNote`;
  - always append `truncationNote`, so a page-capped walk is never reported as complete (`src/tools/truncation.ts:1-12`).
- **Get tools** omit bulky content by default and print `omittedContentSummary` (sha256 and length) along with the flag that returns it, such as `includeScript` or `includeContent`.

### Confirmation Flow For Mutations

1. Without `confirm: true`, the handler returns a plain instruction and does nothing. That result is not an error (`src/tools/template-tools.ts:258-267`).
2. If any `expected*` argument is present, the handler reads the live target and compares. On a mismatch, `guardExpectedFields` returns `isError: true` with "No live mutation was performed" (`src/tools/confirmation-guards.ts:19-52`).
3. Only then does the write run.
4. `appendGuardGuidance` adds the two-phase hint to results that did not use guards.

User-facing description: [Safety](../operations/safety.md#two-phase-target-confirmation).

### Annotations

- `{ readOnlyHint: true }` marks discovery tools.
- `{ readOnlyHint: false }` marks additive writes.
- `DESTRUCTIVE_LIVE_WRITE` marks anything that overwrites, deletes, executes, or provisions, including `create-deployment` by design (`src/tools/annotations.ts:1-21`).
- `test/tool-annotations.test.mjs` enforces the destructive set by name prefix. The categories are listed in the [Tool Reference](../reference/tools.md).

### Resources

- **Static resources** (docs, patterns, schema) use `server.registerResource(name, uri, meta, handler)` (`src/resources/index.ts:305-315`).
  - The two docs resources read `README.md` and `docs/vro-artifact-authoring.md` from the installed package (`src/resources/index.ts:21-25`).
- **Live resources** use a `ResourceTemplate` with `list: undefined`. They fetch through the facade and pass the record through a view (`src/resources/index.ts:455-470`).
- **Snapshot resources** validate the file name, resolve it inside the context directory, and refuse symbolic links (`src/resources/index.ts:618-639`).
- Resource handlers throw on failure. There is no `isError` result for resources.
- **The withholding contract:** a resource withholds what its matching `get-*` tool withholds, and nothing more (`src/resource-views.ts:15-30`). Fields that a tool skips only for brevity are still served.

### Prompts

- `server.registerPrompt(name, { title, description, argsSchema }, callback)`, where `argsSchema` is a raw zod shape, not `z.object` (`src/prompts/index.ts:35-62`).
- Prompts take no client and return fixed playbook text.

### Redaction

- **Typed values:** `isSecureAttributeValue` checks the declared type and the value envelope (`src/redaction.ts:101-109`). `formatVroValueRedacted` prints `[redacted]` for those values (`src/tools/parameter-values.ts:50-54`).
- **Untyped maps:** a key-name heuristic, `SENSITIVE_PROPERTY_KEY` (`src/redaction.ts:20-21`), is the weaker fallback.
- **Not covered:** neither check reaches inside an untyped composite, a log line, or exception text. The modules require every caller to say so in its description and docs.
- **Digests:** `contentMetadata` and `omittedContentSummary` hash the same input the same way, so the tool and resource digests match byte for byte (`src/content-metadata.ts:27-44`).

## Extension Points

- **New tool:** follow the checklist in the Conventions section of `AGENTS.md`. Copy an existing tool's shape: a read-only list, a `confirm`-gated delete (`src/tools/template-tools.ts:214-321`), or a guarded import (`src/tools/workflow-tools.ts:1322-1430`).
- **New live resource:** a `ResourceTemplate` plus a view in `src/resource-views.ts` whenever the matching tool withholds anything.
- **New prompt:** `registerPrompt` in `src/prompts/index.ts` and a heading in `docs/reference/resources-prompts.md`.

## Gotchas

- `scripts/validate-docs.mjs` parses the literal registration calls and the reference headings. A tool registered any other way, or documented under a different heading, fails `validate:docs`.
- A mismatch on the `confirm` flag is not an error, but a guard mismatch is. Tests and clients rely on that difference.
- Adding a withheld field to a `get-*` tool without updating the matching view in `src/resource-views.ts` reopens the bypass that VCFO-092 closed.
- Changing how content is hashed in one place breaks digest equality with the other.
