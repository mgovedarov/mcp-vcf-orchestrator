# Native Action Wrapper Example

Use this flow when a workflow should expose one existing vRO action through workflow inputs and
outputs. The scaffold emits a native action workflow item directly — no scriptable
`System.getModule(...)` wrapper and no manual XML editing.

## Discover The Action

Verify the action contract first; never invent module names, parameters, or return types.

```text
list-actions(filter: "echo")
get-action(id: "<action-id>", includeScript: true)
```

Confirm the `module`, `name`, ordered input parameters and types, and the return type from the result.

## Scaffold A Native Action Item

Pass a task with `kind: "action"`. Map each workflow input to an action input through `inputs`
(in action signature order), and bind the return value with `resultBinding`. Omit `resultBinding`
for an action that returns nothing.

```text
scaffold-workflow-file(fileName: "echo-wrapper.workflow", overwrite: false, workflow: {
  name: "Echo Wrapper",
  description: "Wrap the echo action.",
  inputs: [{ name: "message", type: "string", description: "Message to echo" }],
  outputs: [{ name: "result", type: "string", description: "Echoed message" }],
  tasks: [{
    kind: "action",
    displayName: "Echo",
    module: "com.example.actions",
    actionName: "echo",
    inputs: [{ name: "message", type: "string", source: "message" }],
    resultBinding: { name: "result", type: "string" }
  }]
})
```

The generated `workflow-content` contains a `<workflow-item type="task" script-module="com.example.actions/echo">`
item whose script is `actionResult = System.getModule("com.example.actions").echo(message);`, with an
`out-binding` from `actionResult` to `result`.

## Preflight, Import, And Verify

`preflight-workflow-file` lists the native action item under `native-action-items` and reports the
`com.example.actions/echo` reference.

```text
preflight-workflow-file(fileName: "echo-wrapper.workflow")
list-categories(type: "WorkflowCategory", filter: "Development")
import-workflow-file(categoryId: "<workflow-category-id>", fileName: "echo-wrapper.workflow", overwrite: true, confirm: true)
list-workflows(filter: "Echo Wrapper")
get-workflow(id: "<workflow-id>")
run-workflow-and-wait(id: "<workflow-id>", inputs: [{ name: "message", value: "hello" }], timeoutSeconds: 60, pollIntervalSeconds: 2, confirm: true)
```

> **Note (VCFO-060):** the scaffolded `.workflow` container is not yet accepted by live vRO import
> (differences in the `workflow-info` format, content encoding, and the lack of an explicit end item).
> Until that is resolved, treat the `import-workflow-file` and `run-workflow-and-wait` steps above as the
> intended end-to-end flow rather than a working loop: use `preflight-workflow-file` / `diff-workflow-file`
> for local validation and publish reusable content through the project package path.
