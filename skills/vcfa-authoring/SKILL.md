---
name: vcfa-authoring
description: >-
  Author and promote VCF Automation Orchestrator (vRO) content safely through
  the mcp-vcf-orchestrator MCP server. Use when the user wants to create,
  update, scaffold, refactor, review, promote, or import a vRO workflow,
  action, configuration element, resource element, or package, or to publish
  reusable content through the project package. Encodes the server's
  discovery-first, confirm-before-write lifecycle and routes to the matching
  vcfa-* prompts. Does not invent vRO IDs, schemas, or contracts.
---

# VCFA Authoring

Drive the VCF Automation Orchestrator MCP server when authoring or promoting vRO
artifacts. Stay discovery-first and conservative with the live environment. This
skill orchestrates the server's own prompts, resources, and tools — it does not
replace them.

## Core principles

- Discover before you write. Start with the `list-*` and `get-*` tools and verify
  every ID, category, schema, and contract from the live environment, docs, or
  configured tools. Never invent vRO IDs, parameter schemas, action contracts,
  package names, or category IDs.
- Mutating tools require a `confirm: true` argument. That schema flag is not a
  substitute for real user confirmation — confirm the exact target, expected
  impact, and rollback or backup plan with the user before any live write.
- Keep local artifact work inside the configured artifact directories. Pass plain
  file names, never paths, absolute paths, traversal, or symlinks.

## Prefer the server prompts

Reach for the server-provided prompts first — they encode the full playbooks:

- `vcfa-discover-capabilities` — explore installed plugins, categories, reusable
  actions, workflows, and gaps before designing anything.
- `vcfa-collect-context-snapshot` — persist reusable environment context in
  unfamiliar or large environments.
- `vcfa-discovery-first-implementation-plan` — produce a phased plan that begins
  with verified read-only discovery.
- `vcfa-author-workflow` — plan, scaffold, preflight, and safely import a workflow.
- `vcfa-build-workflow-from-action` — wrap an existing action's verified contract
  in a workflow.
- `vcfa-refactor-workflow` — inspect, export, diff, and plan a safe refactor.
- `vcfa-review-artifact-import` — review a local artifact before import.

## Artifact lifecycle

Follow this sequence unless the user explicitly asks for a narrower read-only review:

1. Discover the live target and dependencies with `list-*` / `get-*` tools.
2. Export or snapshot existing live state when replacing content
   (`export-workflow-file`, `export-action-file`, `export-configuration-file`,
   `export-resource-element`, `export-package`).
3. Author or modify the local artifact (`scaffold-workflow-file`,
   `create-workflow`, `create-action`, `create-configuration`).
4. Validate with the matching preflight tool (`preflight-workflow-file`,
   `preflight-action-file`, `preflight-configuration-file`, `preflight-package`).
5. Diff when replacing a workflow or action (`diff-workflow-file`,
   `diff-action-file`).
6. Run `prepare-artifact-promotion` to bundle preflight, optional backup export,
   and change summaries before a live replacement.
7. Confirm the exact target and impact with the user.
8. Import or publish (`import-workflow-file`, `import-action-file`,
   `import-configuration-file`, `import-resource-element`, `import-package`).
9. Verify with read-only inspection or a confirmed execution.

## Package-first publishing

Move reusable project content through the stable project package by default. Do
not create random, timestamped, or task-specific packages.

`ensure-project-package` → `add-workflow-to-project-package` /
`add-action-to-project-package` / `add-configuration-to-project-package` /
`add-resource-to-project-package` → `rebuild-project-package` →
`export-project-package` → `get-project-package-import-details` →
`import-project-package`.

Use direct `import-*-file` tools only for narrow validation or an explicitly
requested one-off test.

## Authoring detail lives in the server resources

Do not re-derive authoring rules here. Read the server resources for the current,
authoritative detail:

- `vcfa://docs/artifact-authoring` — full vRO artifact authoring guide
  (input forms, native action items, layout, encoding rules).
- `vcfa://schemas/workflow-scaffold` — the workflow scaffold schema.
- `vcfa://patterns/workflows/basic-scriptable-task` and
  `vcfa://patterns/workflows/action-wrapper` — workflow patterns to start from.
