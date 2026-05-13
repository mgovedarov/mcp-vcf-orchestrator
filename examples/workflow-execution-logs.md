# Workflow Execution Logs Example

Use this flow when a workflow has already run and you need to inspect or persist its execution syslogs. These logs include workflow token messages written with `System.log`, `System.debug`, `System.warn`, and `System.error`.

## Find The Execution

```text
list-workflows(filter: "Test Wf")
list-workflow-executions(workflowId: "<workflow-id>", maxResults: 20)
get-workflow-execution(workflowId: "<workflow-id>", executionId: "<execution-id>")
```

## Show Logs Inline

Show all fetched syslogs:

```text
get-workflow-execution-logs(
  workflowId: "<workflow-id>",
  executionId: "<execution-id>",
  maxResult: 50
)
```

Show only error entries:

```text
get-workflow-execution-logs(
  workflowId: "<workflow-id>",
  executionId: "<execution-id>",
  level: "error",
  maxResult: 50
)
```

## Export Logs

Export info-and-higher entries to JSON under `VCFA_EXECUTION_LOG_DIR`, or under `VCFA_ARTIFACT_DIR/execution-logs` when no override is set:

```text
get-workflow-execution-logs(
  workflowId: "<workflow-id>",
  executionId: "<execution-id>",
  fileName: "execution-logs.json",
  level: "info",
  format: "json",
  maxResult: 200,
  overwrite: true
)
```

Use `fileName: "execution-logs.txt"` and `format: "text"` for a human-readable export. File names must be plain `.json` or `.txt` names, not paths.
