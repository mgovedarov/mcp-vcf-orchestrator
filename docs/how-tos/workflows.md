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

## Scaffold, Import, And Test A Workflow

Use `scaffold-workflow-file` for real importable `.workflow` artifacts instead of hand-building ZIP/XML content.

```text
User: Create a simple workflow artifact called Echo Message. It should take
message as a string and return result as a string.
```

Recommended tool sequence:

1. `scaffold-workflow-file` with workflow inputs, outputs, tasks, and bindings.
2. `preflight-workflow-file(fileName: "echo-message.workflow")`.
3. `list-categories(type: "WorkflowCategory", filter: "Dev")`.
4. `import-workflow-file(..., confirm: true)`.
5. `list-workflows(filter: "Echo Message")`.
6. `run-workflow-and-wait(...)`.

Example scaffold task:

```json
{
  "displayName": "Echo",
  "script": "result = message;",
  "inBindings": [{ "name": "message", "type": "string", "source": "message" }],
  "outBindings": [{ "name": "result", "type": "string", "target": "result" }]
}
```

## Inspect Platform Capabilities Before Writing Code

Before creating new workflow code, discover existing plugins and reusable actions:

1. `list-plugins()`
2. `list-plugins(filter: "nsx")`
3. `list-actions(filter: "getAllMachines")`
4. `get-action(id: "<candidate-action-id>")`

If discovery does not find the required action, category, parameter, or plugin, stop and report the missing detail instead of inventing a schema.
