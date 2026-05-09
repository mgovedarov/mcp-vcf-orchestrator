# Workflow Artifact Example

Use this flow when the assistant needs to author a real importable `.workflow` artifact.

## Discover And Snapshot

```text
Use prompt vcfa-collect-context-snapshot with:
goal: "Collect reusable workflow and action context before authoring an Echo Message workflow."
includeOptionalDomains: true
```

Direct tool call:

```text
collect-context-snapshot(fileBaseName: "echo-message-context", includeOptionalDomains: true, overwrite: true)
```

## Scaffold Locally

```text
scaffold-workflow-file(fileName: "echo-message.workflow", overwrite: false, workflow: {
  name: "Echo Message",
  description: "Return the supplied message.",
  inputs: [{ name: "message", type: "string", description: "Message to echo" }],
  outputs: [{ name: "result", type: "string", description: "Echoed message" }],
  tasks: [{
    displayName: "Echo",
    script: "result = message;",
    inBindings: [{ name: "message", type: "string", source: "message" }],
    outBindings: [{ name: "result", type: "string", target: "result" }]
  }]
})
```

## Preflight, Import, And Verify

```text
preflight-workflow-file(fileName: "echo-message.workflow")
list-categories(type: "WorkflowCategory", filter: "Development")
import-workflow-file(categoryId: "<workflow-category-id>", fileName: "echo-message.workflow", overwrite: true, confirm: true)
list-workflows(filter: "Echo Message")
get-workflow(id: "<workflow-id>")
run-workflow-and-wait(id: "<workflow-id>", inputs: [{ name: "message", value: "hello" }], timeoutSeconds: 60, pollIntervalSeconds: 2)
```
