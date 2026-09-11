# vRA 8 Verification Matrix

Per-tool status of `VCFA_TARGET_PLATFORM=vra8`, from the full-surface live sweep run under VCFO-075.

**Environment:** vRA 8.18 / vRO 8.18.1, provider user in the `System Domain` vIDM domain, 2026-09-11.
**Inventory:** 565 workflows, 613 actions, 134 workflow categories, 2 configuration categories, 27 resource
categories, 2 configuration elements, 11 resource elements, 25 packages, 22 plugins, 70 event topics,
68 subscriptions, 1 project, 1 blueprint, **0 catalog items, 0 deployments**.

All 78 registered tools were invoked through the real MCP tool handlers over stdio (277 captured calls).
The environment was returned to its exact starting counts afterwards.

## How to read the status column

| Status | Meaning |
| --- | --- |
| **Verified** | Called live and the rendered result was checked against the environment, not merely for a 2xx. |
| **Expected refusal** | The `vra8` guard refuses by design; the refusal message was observed. |
| **Unverifiable here** | The call path works but this lab cannot confirm the result — an empty inventory or a missing input. |
| **Fixed** | A defect this sweep found and this change corrects. |

A 200 on an empty list is **not** a pass. Every captured result was also grepped for `undefined`,
`[object Object]`, `NaN`, `(id: )` and for leaked secrets; the only matches were an action *description*
containing the word "undefined" and validation errors from deliberately malformed calls.

## Workflows

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-workflows` | Verified | 565 bare; `filter` matches case-insensitively; `limit` returns the truncation note. `/workflows` ignores `startIndex`, so the flat pager's repeated-page guard fires and the 134-category traversal runs (~9 s, 138 requests) with or without `limit`. |
| `list-workflows-by-category` | Verified | `categoryName: "Mail"` → 7 workflows with the resolved path `Library/Mail`. |
| `get-workflow` | Verified | Inputs, outputs and types rendered; `SecureString` typed correctly. |
| `create-workflow` | Verified | Created in a disposable category; `confirm: false` refuses first. |
| `run-workflow` | Verified | Started an execution; guards and input validation reject before any run. |
| `run-workflow-and-wait` | Verified | Completed and returned `greeting (string): "hello vcfo075"`. |
| `list-workflow-executions` | Verified | Bare and each of the five `status` values. |
| `get-workflow-execution` | Verified | State, timings, owner and output parameters. |
| `get-workflow-execution-logs` | Verified | Inline per level, and file export in `json` and `text`; a real `System.log` line was captured. |
| `export-workflow-file` | Verified | Exported and re-imported; `overwrite: false` refuses an existing file. |
| `scaffold-workflow-file` | Verified | All nine supported input-form types plus both task kinds; an unsupported type is rejected before preflight. |
| `preflight-workflow-file` | Verified | Passes live exports and scaffolds; see the `<description>` note below. |
| `diff-workflow-file` | Verified | All three modes: file/file, live/file, live/live. |
| `import-workflow-file` | Verified | **A scaffolded container imports, opens and runs on vRO 8.18.1** — see VCFO-060 below. |
| `delete-workflow` | Verified | Guard mismatch refuses; correct guard deletes. |

## Actions

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-actions` | Verified | 613 bare; `filter` post-filters client-side; `limit` reports "first 5 of 9". |
| `get-action` | Verified | Accepts **both** a UUID and a fully qualified name; `includeScript` returns the script, otherwise a sha256 summary. |
| `create-action` | Verified | Created with input parameters; **creates the module implicitly**. |
| `update-action` | Verified | Carries input parameters forward when only `script` is supplied. |
| `export-action-file` | **Fixed** | 400 on a fully qualified name (VCFO-076); now resolved to the element id first. |
| `preflight-action-file` | Verified | Passes live exports. |
| `diff-action-file` | **Fixed** | Same FQN defect via the live diff source (VCFO-076). |
| `import-action-file` | Verified, with a caveat | Round-trips into an **existing** module. A not-yet-existing module fails with `404 Action category name not found` — vRO 8.18.1 does not create modules on import (VCFO-079). |
| `delete-action` | Verified | Guard mismatch refuses. Deleting the last action also removes the module — no empty-module residue. |

## Configuration elements

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-configurations` | Verified | `filter` post-filters client-side. |
| `get-configuration` | Verified, with a caveat | `SecureString` renders `[redacted]`; plain values render the raw vRO envelope (`{"string":{"value":"probe-2"}}`) rather than the scalar — tracked as VCFO-080. |
| `create-configuration` | Verified | Created in the built-in `Additions` category. |
| `update-configuration` | Verified | Full two-phase flow: prompt, guard mismatch, write, read-back with the description preserved, description-only update refused, empty `SecureString` refused. |
| `export-configuration-file` | Expected refusal | vRA 8 serves a configuration element as JSON only and answers the artifact request with 406. |
| `preflight-configuration-file` | Verified (local) | Validates ZIP/XML safety. It accepts a hand-built container, so a local pass does **not** imply live import would accept it. |
| `import-configuration-file` | **Unverifiable here** | vRA 8 has no `.vsoconf` source: the export is refused, and a package stores elements as `elements/<id>/data`, not as `.vsoconf` members. |
| `delete-configuration` | Verified | Guard mismatch refuses. |

## Resource elements

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-resource-elements` | Verified | `filter` post-filters client-side; gif matched 2 of 11. |
| `export-resource-element` | Verified | Exported a binary element. |
| `import-resource-element` | Verified | Creates a new element; it has no `overwrite` argument. |
| `update-resource-element` | **Fixed** | `expectedCategoryName` always failed (VCFO-077); now refused with a message saying the category cannot be verified. |
| `delete-resource-element` | **Fixed** | Same defect, same fix. |

## Packages

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-packages` | Verified | 25 bare; `filter` post-filters client-side; amqp matched 1 of 25. |
| `get-package` | Verified | Name and description. |
| `create-package` | Verified | Refuses a name that already exists. |
| `export-package` | Verified | With all four export-option booleans. |
| `preflight-package` | Verified, with a caveat | Reports `workflowArtifacts: 0` for a real vRO package: the scanner looks for nested `.workflow`/`.action`/`.vsoconf` entries, while vRO packages store `elements/<id>/data`. The accompanying warning is accurate. |
| `get-package-import-details` | Verified | 18 elements for `com.vmware.library.amqp`. Note it runs preflight internally despite `readOnlyHint: true`, so it can hard-fail. |
| `import-package` | Verified | With `importConfigurationAttributeValues` and `tagImportMode`. |
| `delete-package` | Verified | Guard mismatch refuses; `deleteContents: false` keeps content. |
| `ensure-project-package` | Verified | Refuses a missing package until `createIfMissing` and `confirm` are both set. |
| `add-workflow-to-project-package` | Verified | Refuses before the package exists. |
| `add-action-to-project-package` | Verified | By `categoryName` + `actionName`. |
| `add-configuration-to-project-package` | Verified | — |
| `add-resource-to-project-package` | Verified | — |
| `rebuild-project-package` | Verified | Four elements in the rebuilt package. It is the only destructive tool with no `expected*` guard. |
| `export-project-package` | Verified | — |
| `get-project-package-import-details` | Verified | — |
| `import-project-package` | Verified | Guard mismatch refuses; a file holding a different package is refused by name. |

## Categories, plugins, context, promotion

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-categories` | Verified | `WorkflowCategory` 134, `ConfigurationElementCategory` 2, `ResourceElementCategory` 27, `ActionCategory` **none** — modules come from the `module` column of `list-actions`. |
| `list-plugins` | Verified | 22, via the flat vRA 8 envelope. |
| `collect-context-snapshot` | Verified | Default and `includeOptionalDomains`; `vcfa://context/latest` resolves. |
| `prepare-artifact-promotion` | Verified | `workflow`, `action` and `package` including backup export and the ready import call; `configuration` returns the documented `Backup skipped:` pointer and still returns the report and recommendation. |

## Automation services

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-projects` / `get-project` | Verified | `search` is sent as an OData `$filter`; `O'Brien` → `substringof('o''brien', …)` answered 200. |
| `list-templates` / `get-template` | Verified | Content omitted behind a sha256 summary by default. |
| `create-template` / `delete-template` | Verified | Disposable DRAFT template; all four `expected*` guards on delete. |
| `list-event-topics` | Verified | 70, with blockable topics marked. |
| `list-subscriptions` | Verified | 68. `runnable: N/A/N/A` is correct — system subscriptions are `type: SUBSCRIBABLE` and carry no runnable. `(unnamed)` renders correctly. `projectId` still fails with `500 could not resolve property: projectId`. |
| `get-subscription` | Verified | — |
| `create-subscription` | Verified | Client-generated UUID, `Location`-header re-read, created disabled and non-blocking. |
| `update-subscription` | Verified | The POST upsert preserves `type`, `broadcast`, `system`, `contextual`, `subscriberId`, `ownerId`, `orgId`, topic and runnable. |
| `delete-subscription` | Verified | Guard mismatch refuses. |
| `list-catalog-items` | **Unverifiable here** | Endpoint and envelope answer; the lab has no catalog items, so the item shape is unconfirmed. |
| `get-catalog-item` | **Unverifiable here** | Only the 404 path exercised. |
| `list-deployments` | **Unverifiable here** | Same as catalog items. |
| `get-deployment` | **Unverifiable here** | Only the 404 path exercised. |
| `list-deployment-actions` | **Unverifiable here** | Only the 404 path exercised. |
| `create-deployment` | Expected refusal | Catalog-service writes withheld pending released catalog content. |
| `delete-deployment` | Expected refusal | Deployment-service writes withheld pending an existing deployment. |
| `run-deployment-action` | Expected refusal | As above. |

## Settled by this run

- **VCFO-060 holds on vRA 8.** A scaffolded `.workflow` — nine input types, a scriptable task and a native
  action item — preflighted, imported, opened and ran on vRO 8.18.1, returning its declared output. The
  container fix was previously verified only on vRO 9.1.
- **VCFO-073 post-filtering confirmed live.** `filter` now matches client-side on `list-packages`,
  `list-categories`, `list-configurations` and `list-resource-elements`. The wire still sends
  `conditions=name~…`, which this platform ignores; the client-side match is what makes the argument work.
- **VCFO-072 `$filter` confirmed live**, including the doubled-quote escape.
- **The safety surface holds.** Every `confirm` gate refused without `confirm: true`; every `expected*`
  mismatch returned `isError` with "No live mutation was performed."; `../`, absolute and nested paths were
  rejected on every export tool and on `collect-context-snapshot`; no password or bearer token appeared in
  277 captured results.

## Still open

`import-configuration-file` and the catalog/deployment item shapes and writes need an environment this lab
cannot provide — a 9.x environment that can export a `.vsoconf`, and a vRA 8 environment with released
catalog content and a live deployment. See [VCFO-074](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/170).
