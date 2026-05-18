# Live Smoke Tests

Use this checklist to validate the MCP server against a real sandbox or disposable VCF Automation/vRO environment. Keep this separate from local validation: `npm run validate` checks the repository and must not contact VCFA.

Run live smoke tests only where it is acceptable to create, run, package, import, or delete disposable test assets. Use harmless workflows and test categories/packages. Review the exact target, expected impact, and rollback path before setting `confirm: true` on any live mutation. Use `VCFA_IGNORE_TLS=true` only in lab environments where you accept the TLS risk.

## Environment Setup

Configure the required connection variables:

```bash
VCFA_HOST=...
VCFA_USERNAME=...
VCFA_ORGANIZATION=...
VCFA_PASSWORD=...
```

Use clearly scoped artifact directories for the smoke run:

```bash
VCFA_ARTIFACT_DIR=./artifacts/live-smoke
VCFA_WORKFLOW_DIR=./artifacts/live-smoke/workflows
VCFA_ACTION_DIR=./artifacts/live-smoke/actions
VCFA_CONFIGURATION_DIR=./artifacts/live-smoke/configurations
VCFA_RESOURCE_DIR=./artifacts/live-smoke/resources
VCFA_PACKAGE_DIR=./artifacts/live-smoke/packages
VCFA_EXECUTION_LOG_DIR=./artifacts/live-smoke/execution-logs
```

For package-first validation, use a disposable package name:

```bash
VCFA_PROJECT_PACKAGE_NAME=com.example.vcfa.mcp.smoke
```

## Read-Only Discovery

Start with read-only calls and record the real IDs returned by the environment:

```text
list-plugins()
list-categories(type: "WorkflowCategory")
list-categories(type: "ActionCategory")
list-categories(type: "ConfigurationElementCategory")
list-categories(type: "ResourceElementCategory")
list-workflows(filter: "<known harmless workflow name>")
get-workflow(id: "<workflow-id>")
list-actions(filter: "<known action name>")
list-configurations()
list-resource-elements()
```

Stop if the required test category, workflow, action, configuration, resource, or package cannot be identified from discovery. Do not substitute guessed IDs.

## Artifact Export And Local Validation

Export a harmless workflow and validate it locally:

```text
export-workflow-file(id: "<workflow-id>", fileName: "smoke.workflow", overwrite: false)
preflight-workflow-file(fileName: "smoke.workflow")
diff-workflow-file(
  base: { source: "file", fileName: "smoke.workflow" },
  compare: { source: "file", fileName: "smoke.workflow" }
)
```

When disposable action or configuration test objects exist, repeat the minimal export and preflight path:

```text
export-action-file(id: "<action-id>", fileName: "smoke.action", overwrite: false)
preflight-action-file(fileName: "smoke.action")

export-configuration-file(id: "<configuration-id>", fileName: "smoke.vsoconf", overwrite: false)
preflight-configuration-file(fileName: "smoke.vsoconf")
```

## Harmless Workflow Execution

Use a known no-op or read-only workflow. Inspect its inputs first, then run it only after confirming the target and impact:

```text
get-workflow(id: "<workflow-id>")
run-workflow-and-wait(
  id: "<workflow-id>",
  inputs: [
    { name: "<input-name>", value: "<safe test value>" }
  ],
  timeoutSeconds: 60,
  pollIntervalSeconds: 2,
  confirm: true
)
```

Verify the execution and logs:

```text
list-workflow-executions(workflowId: "<workflow-id>", maxResults: 5)
get-workflow-execution(workflowId: "<workflow-id>", executionId: "<execution-id>")
get-workflow-execution-logs(workflowId: "<workflow-id>", executionId: "<execution-id>", level: "info", maxResult: 100)
get-workflow-execution-logs(
  workflowId: "<workflow-id>",
  executionId: "<execution-id>",
  fileName: "smoke-execution-logs.json",
  level: "info",
  format: "json",
  maxResult: 200,
  overwrite: false
)
```

## Package-First Validation

Use only a disposable package and disposable content. Create the package only after confirming the package name is correct:

```text
ensure-project-package(createIfMissing: true, confirm: true)
add-workflow-to-project-package(workflowId: "<workflow-id>", confirm: true)
rebuild-project-package(confirm: true)
export-project-package(fileName: "com.example.vcfa.mcp.smoke.package", overwrite: false)
get-project-package-import-details(fileName: "com.example.vcfa.mcp.smoke.package")
```

Review the package identity and element list before any import. In a sandbox only, optionally perform one controlled import:

```text
import-project-package(fileName: "com.example.vcfa.mcp.smoke.package", overwrite: false, confirm: true)
```

## Promotion Planning

Run promotion planning before imports so the operator can review preflight, backup, diff, and the exact recommended import call:

```text
prepare-artifact-promotion(
  kind: "workflow",
  fileName: "smoke.workflow",
  target: {
    categoryId: "<workflow-category-id>",
    workflowId: "<workflow-id>"
  },
  backup: {
    enabled: true,
    fileName: "smoke-backup.workflow",
    overwrite: false
  },
  overwrite: true
)
```

Confirm that the summary names the intended target, reports no blocking preflight issues, includes the expected diff, and recommends the correct import call.

## vRA/vRO 8 Compatibility Mode

For vRA/vRO 8.12+ Basic-auth validation, set:

```bash
VCFA_TARGET_PLATFORM=vra8
```

Verify the intentionally reduced surface:

```text
list-workflows()
get-workflow(id: "<workflow-id>")
run-workflow-and-wait(id: "<workflow-id>", inputs: [], timeoutSeconds: 60, confirm: true)
get-workflow-execution-logs(workflowId: "<workflow-id>", executionId: "<execution-id>", level: "info")
```

Automation-service tools such as catalog, deployment, template, subscription, and event-topic operations should fail with a clear unsupported-operation message in this mode.

## Negative And Safety Checks

Confirm the safety guardrails before trusting the environment for broader work:

```text
run-workflow(id: "<workflow-id>", inputs: [], confirm: false)
delete-workflow(id: "<workflow-id>", confirm: false)
export-workflow-file(id: "<workflow-id>", fileName: "../escape.workflow")
export-workflow-file(id: "<workflow-id>", fileName: "smoke.workflow", overwrite: false)
```

Expected results:

- Live mutation tools refuse to proceed unless `confirm` is `true`.
- Unsafe artifact file names are rejected.
- Existing export targets require `overwrite: true`.
- Surfaced errors include safe diagnostics, such as status and correlation IDs, but not passwords, tokens, private keys, or raw sensitive response bodies.
