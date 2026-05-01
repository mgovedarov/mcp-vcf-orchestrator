# Contributing

## Development Commands

```bash
npm install
npm run build
npm test
npm run docs:build
```

## Adding Tools

When adding a new MCP tool:

1. Add the tool in the relevant `src/tools/*` module.
2. Use existing client modules before introducing new API logic.
3. Mark read-only and destructive annotations accurately.
4. Add tests for success, error, confirmation, and formatting behavior.
5. Update the tool reference and relevant how-to docs.

## Adding Resources Or Prompts

Resources and prompts are registered in the resource and prompt modules. Keep content concrete and discovery-first. When an agent needs environment-specific facts, prompts should direct it to discovery tools instead of relying on memory.

## Artifact Work

When authoring or importing vRO artifacts, read the workflow authoring guide and run preflight before import. Prefer real importable artifacts over illustrative pseudocode.

## Documentation

Docs live under `docs/` and are built with VitePress.

- Add pages to the sidebar in `docs/.vitepress/config.ts`.
- Keep examples aligned with current tool names and schemas.
- Distinguish read-only discovery from live write or destructive operations.
- Run `npm run docs:build` before opening a docs PR.
