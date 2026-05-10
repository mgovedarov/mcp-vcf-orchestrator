# Artifact Lifecycle

The artifact lifecycle is designed to keep live changes deliberate and reviewable.

## 1. Discover

Use read-only tools to identify the live asset and target category:

- `list-workflows`, `get-workflow`
- `list-actions`, `get-action`
- `list-configurations`, `get-configuration`
- `list-packages`, `get-package`
- `list-categories`

## 2. Reuse The Project Package

For package-first workflows, set `VCFA_PROJECT_PACKAGE_NAME` to one stable fully-qualified package name per project. Start with `ensure-project-package`; it reuses the exact package and creates it only when both `createIfMissing` and `confirm` are true. Do not create timestamped or task-specific packages.

Publish reusable project content through this package path by default. Direct artifact imports are useful for narrow validation and one-off tests, but normal promotion into vRO should add content to the project package, rebuild it, export it, inspect package import details, and import the package.

This is the default way to push content into vRO:

1. Create or update the workflow, action, configuration, or resource in vRO or as a local artifact.
2. Verify the content with read-only inspection or preflight tools.
3. Add the live content to the stable project package.
4. Rebuild and export that package.
5. Inspect the exported package with `get-project-package-import-details`.
6. Import the package only after the package name and element list match the intended project change.

Add content to that package with:

- `add-workflow-to-project-package`
- `add-action-to-project-package`
- `add-configuration-to-project-package`
- `add-resource-to-project-package`

Run `rebuild-project-package` before export.

## 3. Export

Export live artifacts before modifying or replacing them:

- `export-workflow-file`
- `export-action-file`
- `export-configuration-file`
- `export-resource-element`
- `export-package`
- `export-project-package`

Export targets must be plain file names under the configured artifact directory. Existing targets require `overwrite: true`.

## 4. Create Or Update Locally

Use `scaffold-workflow-file` to generate `.workflow` artifacts from structured metadata and linear scriptable tasks.

For reusable workflows, a local scaffold is an authoring and validation artifact. After preflight and any live validation, publish the workflow into vRO through the project package path rather than treating the direct workflow import as the final promotion mechanism.

Use native action workflow items for workflow steps that only execute one existing vRO action. Use scriptable tasks when the workflow item performs multiple action calls or additional JavaScript logic. When editing XML/package content, prefer horizontal item placement for simple linear workflows.

For other artifact types, place local files in the matching configured directory:

- workflows: `.workflow`
- actions: `.action`
- configurations: `.vsoconf`
- packages: `.package` or `.zip`
- resources: any supported binary/text resource file

## 5. Preflight

Run preflight before any import:

- `preflight-workflow-file`
- `preflight-action-file`
- `preflight-configuration-file`
- `preflight-package`
- `get-project-package-import-details`

Preflight catches local path safety issues, malformed archives, encoding problems, recognizable metadata, and workflow/action-specific concerns before live upload.

## 6. Diff

Use diffs when replacing workflow or action artifacts:

- `diff-workflow-file`
- `diff-action-file`

Diffs can compare two local artifacts or a live export against a local artifact.

## 7. Promote

Use `prepare-artifact-promotion` for a reviewable summary before import. It can combine preflight, optional backup export, diff summaries, target validation, and an exact recommended import call.

## 8. Import With Confirmation

Imports and destructive operations require explicit confirmation. Recommended final checks:

- The target category or package is correct.
- The artifact file name is correct.
- Preflight has no blocking errors.
- Diffs match the intended change.
- Backup export succeeded when required.

For project content, use:

1. `ensure-project-package`
2. `add-*-to-project-package`
3. `rebuild-project-package`
4. `export-project-package`
5. `get-project-package-import-details`
6. `import-project-package`

`import-project-package` validates that the local package file identifies the same package name requested by `packageName` or `VCFA_PROJECT_PACKAGE_NAME`. If the file contains a different package, stop and export the correct project package before importing.

## 9. Verify

After import, verify with read-only or execution tools:

- `list-workflows`, `get-workflow`, `run-workflow-and-wait`
- `list-actions`, `get-action`
- `list-configurations`, `get-configuration`
- `list-packages`, `get-package`
