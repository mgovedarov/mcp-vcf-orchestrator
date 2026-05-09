# Artifact How-Tos

## Export Before Changing

Before replacing or importing artifacts, export the current live asset.

```text
User: Export the Netbox package and the IPAM workflow before I change them.
```

Recommended sequence:

1. `list-packages(filter: "netbox")`
2. `export-package(name: "com.example.netbox", fileName: "com.example.netbox.package", overwrite: true)`
3. `list-workflows(filter: "IPAM")`
4. `export-workflow-file(id: "<workflow-id>", fileName: "ipam-before-change.workflow", overwrite: true)`

## Preflight Before Upload

Preflight checks run locally before authentication or upload.

```text
User: Validate the updated IPAM workflow artifact before importing it.
```

Recommended call:

```text
preflight-workflow-file(fileName: "ipam-updated.workflow")
```

The workflow preflight validates archive structure, UTF-16 workflow XML, parameters, bindings, task flow, vRO type syntax, action references, and file path safety.

Use the matching preflight for each artifact kind:

1. `preflight-workflow-file(fileName: "ipam-updated.workflow")`
2. `preflight-action-file(fileName: "ipam.action")`
3. `preflight-configuration-file(fileName: "ipam-settings.vsoconf")`
4. `preflight-package(fileName: "com.example.ipam.package")`

## Promote With A Backup And Diff

Use `prepare-artifact-promotion` when replacing live artifacts. It can run preflight, export a live backup, summarize workflow/action diffs, and recommend the exact import call. It never imports by itself.

Recommended sequence:

1. `prepare-artifact-promotion(...)`
2. Review preflight errors, warnings, metadata, backup status, and diff summary.
3. Run the recommended import call only after the user confirms the target and overwrite intent.

For targeted diffs without the promotion wrapper:

1. `diff-workflow-file(base: { source: "live", workflowId: "<workflow-id>" }, compare: { source: "file", fileName: "ipam-updated.workflow" })`
2. `diff-action-file(base: { source: "live", actionId: "<action-id>" }, compare: { source: "file", fileName: "ipam.action" })`

Local validation never imports. Live import remains a separate confirmed step.
