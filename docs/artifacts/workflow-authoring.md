# Workflow Authoring

This page summarizes the repository's practical vRO workflow artifact knowledge. For the full authoring note, see [`vro-artifact-authoring.md`](../vro-artifact-authoring.md).

## Workflow Artifact Format

A `.workflow` file is a ZIP archive containing:

- `workflow-info` — a Java properties file (not XML) with fixed keys (`type=workflow`, `version=2.0`, `charset=UTF-16`, `unicode=true`, `creator=www.dunes.ch`, `owner=`).
- `workflow-content`
- `input_form_` — only when the workflow has UI-startable inputs.

`workflow-content` is XML encoded as **UTF-16BE** with a big-endian BOM (`0xFE 0xFF`). The XML root is a vRO workflow document with metadata such as `id`, `version`, and `api-version`, plus `object-name="workflow:name=generic"` and `editor-version="2.0"`. Do **not** emit `allowed-operations` — it is the read-only marker on Library workflows and blocks the editor from opening an authored workflow. The workflow terminates in an explicit `<workflow-item type="end" end-mode="0">` chained from the last task's `out-name`.

Workflow inputs live under `<input>` and outputs under `<output>`. Scriptable task logic lives in `<workflow-item type="task">` nodes.

When a workflow only needs to execute one existing vRO action, model that step as a native vRO action workflow item instead of a scriptable task that calls `System.getModule(...)`. Use a scriptable task when the workflow item performs more than one action call or needs extra JavaScript logic such as branching, input shaping, validation, or result aggregation.

Prefer horizontal workflow layouts in authored XML/package content. Place sequential items from left to right by increasing `x` positions while keeping `y` positions stable unless a branch needs vertical separation.

## Native Action Item Shape

In exported vRO workflow XML, a native action item is still represented as a `type="task"` workflow item, but it includes a `script-module="<module>/<actionName>"` attribute. vRO also exports a generated script that assigns the action return value to `actionResult`; keep that generated shape when manually authoring package content.

```xml
<workflow-item name="item0" out-name="item1" type="task" script-module="com.example.actions/echo">
  <display-name><![CDATA[Call echo]]></display-name>
  <script encoded="false"><![CDATA[actionResult = System.getModule("com.example.actions").echo(message);]]></script>
  <in-binding>
    <bind name="message" type="string" export-name="message"/>
  </in-binding>
  <out-binding>
    <bind name="actionResult" type="string" export-name="result"/>
  </out-binding>
  <position y="100.0" x="180.0"/>
</workflow-item>
<workflow-item name="item1" type="end" end-mode="0">
  <in-binding/>
  <position y="100.0" x="420.0"/>
</workflow-item>
```

Do not omit the generated `actionResult = System.getModule(...).action(...)` script when hand-editing exported package content. A `script-module` attribute without the generated script can import and run but may return `undefined`.

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

The current scaffold tool emits scriptable task items. For a single-action wrapper that must use a native action element, start from an exported valid workflow/package shape or manually author the action item before publishing through the project package flow.

## Robust Script Helpers

Portable workflow scripts often need small helpers for vRO object shapes:

- `toText(value)` for null-safe string conversion.
- `normalize(value)` for trimmed, case-insensitive matching.
- `getField(object, fieldName)` for direct property and getter access.
- `asArray(value)` for arrays and common paged response shapes.

Keep generated scripts readable because runtime errors often reference workflow item line numbers.

## Common Pitfalls

- `create-workflow` creates only an empty workflow shell; use `import-workflow-file` for real workflow content.
- `.workflow` `workflow-content` must be UTF-16BE with a big-endian BOM, `workflow-info` must be the Java properties file, and the workflow must end in an explicit `<workflow-item type="end">`; otherwise live import fails with `400 "Not a valid workflow file"`.
- Multipart imports break if `Content-Type` is set manually without the boundary.
- Workflow execution is asynchronous; poll with `get-workflow-execution` or use `run-workflow-and-wait`.
- Action imports use category/module name, while workflow and configuration imports use category IDs.
