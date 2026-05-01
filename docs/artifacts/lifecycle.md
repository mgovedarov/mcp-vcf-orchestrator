# Artifact Lifecycle

The artifact lifecycle is designed to keep live changes deliberate and reviewable.

## 1. Discover

Use read-only tools to identify the live asset and target category:

- `list-workflows`, `get-workflow`
- `list-actions`, `get-action`
- `list-configurations`, `get-configuration`
- `list-packages`, `get-package`
- `list-categories`

## 2. Export

Export live artifacts before modifying or replacing them:

- `export-workflow-file`
- `export-action-file`
- `export-configuration-file`
- `export-resource-element`
- `export-package`

Export targets must be plain file names under the configured artifact directory. Existing targets require `overwrite: true`.

## 3. Create Or Update Locally

Use `scaffold-workflow-file` to generate `.workflow` artifacts from structured metadata and linear scriptable tasks.

For other artifact types, place local files in the matching configured directory:

- workflows: `.workflow`
- actions: `.action`
- configurations: `.vsoconf`
- packages: `.package` or `.zip`
- resources: any supported binary/text resource file

## 4. Preflight

Run preflight before any import:

- `preflight-workflow-file`
- `preflight-action-file`
- `preflight-configuration-file`
- `preflight-package`

Preflight catches local path safety issues, malformed archives, encoding problems, recognizable metadata, and workflow/action-specific concerns before live upload.

## 5. Diff

Use diffs when replacing workflow or action artifacts:

- `diff-workflow-file`
- `diff-action-file`

Diffs can compare two local artifacts or a live export against a local artifact.

## 6. Promote

Use `prepare-artifact-promotion` for a reviewable summary before import. It can combine preflight, optional backup export, diff summaries, target validation, and an exact recommended import call.

## 7. Import With Confirmation

Imports and destructive operations require explicit confirmation. Recommended final checks:

- The target category or package is correct.
- The artifact file name is correct.
- Preflight has no blocking errors.
- Diffs match the intended change.
- Backup export succeeded when required.

## 8. Verify

After import, verify with read-only or execution tools:

- `list-workflows`, `get-workflow`, `run-workflow-and-wait`
- `list-actions`, `get-action`
- `list-configurations`, `get-configuration`
- `list-packages`, `get-package`
