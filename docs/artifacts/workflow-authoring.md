# Workflow Authoring

This page summarizes the repository's practical vRO workflow artifact knowledge. For the full authoring note, see [`vro-artifact-authoring.md`](../vro-artifact-authoring.md).

## Workflow Artifact Format

A `.workflow` file is a ZIP archive containing at least:

- `workflow-info`
- `workflow-content`

`workflow-content` is XML encoded as UTF-16 with a BOM. The XML root is a vRO workflow document with metadata such as `id`, `version`, and `api-version`.

Workflow inputs live under `<input>`, outputs under `<output>`, and scriptable task logic lives in `<workflow-item type="task">` nodes.

## Scriptable Task Bindings

Task variables must be connected to workflow parameters:

```xml
<in-binding>
  <bind name="projectName" type="string" export-name="projectName"/>
</in-binding>
<out-binding>
  <bind name="vms" type="Array/Properties" export-name="vms"/>
</out-binding>
```

The scaffold tool validates binding references and type matches.

## Scaffolded Workflow Pattern

Use `scaffold-workflow-file` with:

- workflow metadata: name, description, version, API version
- inputs, outputs, and attributes
- one or more scriptable tasks
- explicit in/out bindings per task

Then run `preflight-workflow-file` before import.

## Robust Script Helpers

Portable workflow scripts often need small helpers for vRO object shapes:

- `toText(value)` for null-safe string conversion.
- `normalize(value)` for trimmed, case-insensitive matching.
- `getField(object, fieldName)` for direct property and getter access.
- `asArray(value)` for arrays and common paged response shapes.

Keep generated scripts readable because runtime errors often reference workflow item line numbers.

## Common Pitfalls

- `create-workflow` creates only an empty workflow shell; use `import-workflow-file` for real workflow content.
- `.workflow` content must preserve UTF-16 encoding with BOM.
- Multipart imports break if `Content-Type` is set manually without the boundary.
- Workflow execution is asynchronous; poll with `get-workflow-execution` or use `run-workflow-and-wait`.
- Action imports use category/module name, while workflow and configuration imports use category IDs.
