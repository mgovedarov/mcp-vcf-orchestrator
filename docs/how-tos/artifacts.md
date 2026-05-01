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

## Promote With A Backup And Diff

Use `prepare-artifact-promotion` when replacing live artifacts. It can run preflight, export a live backup, summarize workflow/action diffs, and recommend the exact import call. It never imports by itself.

Recommended sequence:

1. `prepare-artifact-promotion(...)`
2. Review preflight errors, warnings, metadata, backup status, and diff summary.
3. Run the recommended import call only after the user confirms the target and overwrite intent.
