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

> **Verified (VCFO-060, VCFO-075):** the scaffolded `.workflow` container imports, opens, and runs on live
> vRO. The container fix shipped in 2.2.1 was verified on vRO 9.1, and the same flow — scaffold, preflight,
> `import-workflow-file`, `run-workflow-and-wait` — was re-verified end to end on vRO 8.18.1 in
> `VCFA_TARGET_PLATFORM=vra8` mode, including a native action item and a workflow returning its output.
> Use `import-workflow-file` for validation or a one-off test, and still publish reusable content through
> the project package path.
