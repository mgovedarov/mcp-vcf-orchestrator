# Examples

These examples are current, import-safe patterns for using the MCP tools. They are intentionally concise and use placeholder IDs; discover real IDs with read-only tools before running write operations.

## Example Set

- [Workflow Artifact](./workflow-artifact.md): collect context, scaffold a workflow, preflight, import, and test it.
- [Project Package](./project-package.md): reuse one project package, add content, rebuild, export, and inspect before import.
- [Artifact Promotion](./artifact-promotion.md): preflight, diff, optional backup, and import recommendation.
- [Template, Catalog, And Subscription](./template-catalog-subscription.md): review templates, inspect catalog/deployment behavior, and plan subscriptions.

## Safety Defaults

- Use `collect-context-snapshot` or read-only list/get tools before drafting changes.
- Use preflight and diff tools before imports.
- Reuse `VCFA_PROJECT_PACKAGE_NAME` for package-first workflows; do not create one-off packages.
- Treat live write tools as final steps that require confirmed target IDs and explicit user approval.
