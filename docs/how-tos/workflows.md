# Workflow How-Tos

## Run A Workflow With Validated Inputs

Use this flow when you know the desired behavior but not the workflow schema.

```text
User: Find the workflow we use to resize a deployment, show me the inputs,
then run it for deployment dep-123 with size large and wait for the result.
```

Recommended tool sequence:

1. `list-workflows(filter: "resize")`
2. `get-workflow(id: "...")`
3. `run-workflow-and-wait(...)`

`run-workflow-and-wait` validates inputs before running and polls until completion. If the workflow fails, the response includes current item details, stack information, log excerpts, and warnings when diagnostics cannot be fetched.

## Scaffold, Publish, And Test A Workflow

Use `scaffold-workflow-file` for real importable `.workflow` artifacts instead of hand-building ZIP/XML content.

For workflows that only call one existing vRO action, prefer a native action workflow item and publish it through the project package flow. Use a scriptable task when the workflow item performs multiple action calls or extra JavaScript logic. For authored XML/package content, arrange simple linear workflows horizontally from left to right.

Generated workflow artifacts include an `input_form_` entry for workflow inputs so the vRO UI can render the start form. The form uses UTF-16BE with a BOM, a single `page_general` page, section objects with only `id` and `fields`, and field entries that reference matching schema keys. Do not add section titles or ad hoc field properties such as `size`; vRO rejects those shapes when opening the workflow start page.

```text
User: Create a simple workflow artifact called Echo Message. It should take
message as a string and return result as a string.
```

Recommended tool sequence:

1. `scaffold-workflow-file` with workflow inputs, outputs, tasks, and bindings.
2. `preflight-workflow-file(fileName: "echo-message.workflow")`.
3. For a narrow validation run only, `list-categories(type: "WorkflowCategory", filter: "Dev")` and `import-workflow-file(..., confirm: true)`.
4. Verify the workflow with `list-workflows(filter: "Echo Message")`, `get-workflow`, and `run-workflow-and-wait(...)`.
5. Publish reusable project content through the project package:
   - `ensure-project-package(packageName: "com.example.project")`
   - `add-workflow-to-project-package(packageName: "com.example.project", workflowId: "<workflow-id>", confirm: true)`
   - `rebuild-project-package(packageName: "com.example.project", confirm: true)`
   - `export-project-package(packageName: "com.example.project", fileName: "com.example.project.package", overwrite: true)`
   - `get-project-package-import-details(packageName: "com.example.project", fileName: "com.example.project.package")`
   - `import-project-package(packageName: "com.example.project", fileName: "com.example.project.package", overwrite: true, confirm: true)`

Direct `import-workflow-file` is a validation or one-off test path. The project package path is the normal way to push reusable workflow content into vRO.

Example scaffold task:

```json
{
  "displayName": "Echo",
  "script": "result = message;",
  "inBindings": [{ "name": "message", "type": "string", "source": "message" }],
  "outBindings": [{ "name": "result", "type": "string", "target": "result" }]
}
```

This scaffold example is appropriate because it contains custom inline echo logic. If the workflow were only wrapping an existing `echo` action, use a native action workflow item instead of a scriptable task that only calls the action.

Native action wrapper XML should preserve vRO's exported action-item shape:

```xml
<workflow-item name="item0" out-name="item1" type="task" script-module="com.example.actions/echo">
  <script encoded="false"><![CDATA[actionResult = System.getModule("com.example.actions").echo(message);]]></script>
  <in-binding>
    <bind name="message" type="string" export-name="message"/>
  </in-binding>
  <out-binding>
    <bind name="actionResult" type="string" export-name="result"/>
  </out-binding>
  <position y="100.0" x="180.0"/>
</workflow-item>
```

The `script-module` attribute marks the item as a native action item. The generated `actionResult` script and output binding are still required for the action return value to reach the workflow output.

## Inspect Platform Capabilities Before Writing Code

Before creating new workflow code, discover existing plugins and reusable actions:

1. `list-plugins()`
2. `list-plugins(filter: "nsx")`
3. `list-actions(filter: "getAllMachines")`
4. `get-action(id: "<candidate-action-id>")`

If discovery does not find the required action, category, parameter, or plugin, stop and report the missing detail instead of inventing a schema.

## Use Prompt-Driven Discovery

When the environment is unfamiliar, start with a prompt or persisted snapshot instead of ad hoc guessing:

```text
Use prompt vcfa-discover-capabilities with:
goal: "Find reusable VM provisioning workflows, actions, templates, catalog items, and subscriptions."
```

For reusable context that future agents can read:

```text
collect-context-snapshot(fileBaseName: "vm-provisioning-context", includeOptionalDomains: true, maxItemsPerDomain: 300, overwrite: true)
```

The snapshot output includes Markdown and JSON files plus `vcfa://context/latest` and `vcfa://context/snapshots/{fileName}` resource URIs for later discovery.
