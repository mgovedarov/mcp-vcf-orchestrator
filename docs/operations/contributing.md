# Contributing

## Development Commands

```bash
npm install
npm run build
npm test
npm run test:coverage:check
npm run validate:docs
npm run docs:build
npm run validate:package
npm run validate
```

## Adding Tools

When adding a new MCP tool:

1. Add the tool in the relevant `src/tools/*` module.
2. Use existing client modules before introducing new API logic.
3. Mark read-only and destructive annotations accurately. Tools that overwrite or delete live state must use the shared `DESTRUCTIVE_LIVE_WRITE` constant from `src/tools/annotations.ts`; `test/tool-annotations.test.mjs` fails if a new `import-`/`delete-`/`update-`/`run-` tool is not annotated and listed there.
4. Add tests for success, error, confirmation, and formatting behavior.
5. Update the tool reference with a collapsible parameters section directly under the tool, and update relevant how-to docs.

## Adding Resources Or Prompts

Resources and prompts are registered in the resource and prompt modules. Keep content concrete and discovery-first. When an agent needs environment-specific facts, prompts should direct it to discovery tools instead of relying on memory.

When adding or changing a prompt, update the prompt reference with a collapsible parameters section directly under the prompt.

`npm run validate:docs` compares registered tool, prompt, and resource names against the reference docs. It also checks documented tool-call examples for stale tool names and top-level argument names.

## Artifact Work

When authoring or importing vRO artifacts, read the workflow authoring guide and run preflight before import. Prefer real importable artifacts over illustrative pseudocode.

## Documentation

Docs live under `docs/` and are built with VitePress.

- Add pages to the sidebar in `docs/.vitepress/config.ts`.
- Keep examples aligned with current tool names and schemas.
- Add or update root `examples/` flows when new capabilities change common usage patterns.
- Keep tool and prompt parameters documented directly under each tool or prompt in collapsible sections.
- Distinguish read-only discovery from live write or destructive operations.
- Run `npm run validate:docs` and `npm run docs:build` before opening a docs PR.

## GitHub Actions

The repository uses GitHub Actions for CI, dependency review, CodeQL analysis, package dry-runs, documentation deployment, and npm publishing. Keep workflow changes narrow and prefer official GitHub/npm actions where possible.

- CI runs tests across supported Node versions and runs the full validation gate on Node 24.
- Package Check runs `npm run validate:package` for changes that affect published package contents.
- Publish to npm runs only for published GitHub releases and expects npm trusted publishing to be configured.
