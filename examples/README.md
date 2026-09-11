# Examples

These examples are current, import-safe patterns for using the MCP tools. They are intentionally concise and use placeholder IDs; discover real IDs with read-only tools before running write operations.

## Example Set

- [Workflow Artifact](./workflow-artifact.md): collect context, scaffold a workflow, preflight, import, and test it.
- [Native Action Wrapper](./native-action-wrapper.md): discover an action, scaffold a native action workflow item, preflight, import, and run it.
- [Project Package](./project-package.md): reuse one project package, add content, rebuild, export, and inspect before import.
- [Artifact Promotion](./artifact-promotion.md): preflight, diff, optional backup, and import recommendation.
- [Workflow Execution Logs](./workflow-execution-logs.md): show, filter, and export execution syslogs from workflow runs.
- [Template, Catalog, And Subscription](./template-catalog-subscription.md): review templates, inspect catalog/deployment behavior, and plan subscriptions.
- vRA/vRO 8.12+ mode: set `VCFA_TARGET_PLATFORM=vra8`. The full vRO surface works there, including authoring and imports, as do the Automation-service read tools; Automation-service writes and `export-configuration-file` are unsupported in that mode.

## Bounded Discovery

Request a small inventory sample, or bound the results of a supported search:

```text
list-workflows({ limit: 10 })
list-catalog-items({ search: "ubuntu", limit: 5 })
list-actions({ filter: "clone", limit: 10 })
list-event-topics({ limit: 20 })
```

Limits apply after filtering. A limit notice means more matching items exist; a total is shown only when known. Raise the limit (up to 1000), refine a supported filter/search, or omit the limit for full discovery. An unknown total may require an additional page to verify whether more results exist. A pagination-cap warning is separate from the caller's item limit.

Local filters may still scan many pages, some endpoints ignore requested page sizes, and the sorted workflow category fallback still traverses fully before slicing. See [Optional Inventory Limits](../docs/reference/tools.md#optional-inventory-limits) for the full contract. Snapshot and promotion flows keep their full-inventory behavior.

## Safety Defaults

- Use `collect-context-snapshot` or read-only list/get tools before drafting changes.
- Use preflight and diff tools before imports.
- Reuse `VCFA_PROJECT_PACKAGE_NAME` for package-first workflows; do not create one-off packages.
- Treat live write tools as final steps that require confirmed target IDs and explicit user approval.
