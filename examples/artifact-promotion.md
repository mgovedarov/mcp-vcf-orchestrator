# Artifact Promotion Example

Use this flow when replacing a live workflow, action, configuration, or package from a local artifact.

## Prepare Promotion

```text
prepare-artifact-promotion(kind: "workflow", fileName: "echo-message.workflow", target: {
  categoryId: "<workflow-category-id>",
  workflowId: "<live-workflow-id>"
}, backup: {
  enabled: true,
  fileName: "echo-message-backup.workflow",
  overwrite: false
}, overwrite: true)
```

The promotion tool runs local preflight, optionally exports a backup, summarizes workflow/action diffs when a live target is provided, and returns the exact import call to run later. It never imports by itself.

## Final Import

Only after reviewing the promotion output and confirming the target:

```text
import-workflow-file(categoryId: "<workflow-category-id>", fileName: "echo-message.workflow", overwrite: true, confirm: true)
get-workflow(id: "<workflow-id>")
run-workflow-and-wait(id: "<workflow-id>", inputs: [{ name: "message", value: "post-import check" }], timeoutSeconds: 60, confirm: true)
```

For action replacements, use `preflight-action-file(fileName: "example.action")` and `diff-action-file(base: { source: "live", actionId: "<action-id>" }, compare: { source: "file", fileName: "example.action" })` before importing.
