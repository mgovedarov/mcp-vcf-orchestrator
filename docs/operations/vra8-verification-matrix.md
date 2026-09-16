# vRA 8 Verification Matrix

Per-tool status of `VCFA_TARGET_PLATFORM=vra8`, from the full-surface live sweep run under VCFO-075.

**Environment:** vRA 8.18 / vRO 8.18.1, provider user in the `System Domain` vIDM domain, 2026-09-11.
**Inventory:** 565 workflows, 613 actions, 134 workflow categories, 2 configuration categories, 27 resource
categories, 2 configuration elements, 11 resource elements, 25 packages, 22 plugins, 70 event topics,
68 subscriptions, 1 project, 1 blueprint, **0 catalog items, 0 deployments** — until 2026-09-16, when the lab
gained one released catalog item and one deployment; see the [VCFO-088 section](#catalog-and-deployment-writes-2026-09-16-vcfo-088) below.

All 78 registered tools were invoked through the real MCP tool handlers over stdio (277 captured calls).
The environment was returned to its exact starting counts afterwards.

This matrix covers `vra8` only. For the default `VCFA_TARGET_PLATFORM=vcfa` platform, see the
[VCF Automation Verification Matrix](./vcfa-verification-matrix.md). Neither matrix is evidence
for the other platform.

## Post-sweep additions

| Tool | Status | Evidence |
| --- | --- | --- |
| `get-deployment-request` | Route observed; MCP tool pending live verification | Added after the 78-tool sweep under VCFO-094. The underlying `GET /deployment/api/requests/{id}` route was read by raw HTTP during the VCFO-088 round: power and delete requests moved through `PENDING` or `INITIALIZATION`, `INPROGRESS`, and `SUCCESSFUL`, with task progress and timestamps. The new handler and renderer are covered locally, but have not yet been driven through stdio against this lab. |

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
| `list-catalog-items` | Verified under VCFO-088 | Unverifiable in this sweep (empty catalog); the released `ubunutu` item was listed and read on 2026-09-16 — see the VCFO-088 section below. |
| `get-catalog-item` | Verified under VCFO-088 | Only the 404 path here; the item, its `type` and its (empty) request schema rendered in the VCFO-088 round. |
| `list-deployments` | Verified under VCFO-088 | Bare and `projectId`-scoped, with one, two and again one deployment present. |
| `get-deployment` | Verified under VCFO-088 | Renders name, status, the project name resolved through the project service, catalog item and blueprint versions. |
| `list-deployment-actions` | Verified under VCFO-088 | Ten deployment-level actions, bare-array arm. |
| `create-deployment` | Verified under VCFO-088 | Refused in this sweep by design; lifted after the 2026-09-16 round provisioned through the real handler. |
| `delete-deployment` | Verified under VCFO-088, defect found and fixed | Refused in this sweep by design; lifted after the 2026-09-16 round. The success text overstated completion — see below. |
| `run-deployment-action` | Verified under VCFO-088 | Refused in this sweep by design; lifted after `PowerOff` and `PowerOn` were submitted through the real handler — the first day-2 action on any platform. |

## Catalog and deployment writes, 2026-09-16 (VCFO-088)

The rows above were measured on a lab with an empty catalog. This section is a separate round on the
same appliance, same user, once the lab held **one released catalog item** (`ubunutu`, a blueprint-backed
`com.vmw.blueprint` with a single version and an empty request schema) and **one pre-existing deployment**
belonging to the environment's owner, which was read but never acted on. It is what lifted the
`catalog` and `deployment` entries of the `vra8` write guard.

**Method.** Two passes, per [VCFO-088](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/196):

- **Pass A, guards in place.** A throwaway stdio client drove the real handlers to capture every
  `confirm: false` refusal, every `expected*` mismatch arm and the three `vra8` refusals themselves; a
  raw-HTTP probe — the server's own `VroHttpClient.authenticatedFetch`, which bypasses the guard that lives
  in `send` — then performed the same writes and dumped **response keys only** (never a token or a body).
- **Pass B, guards lifted.** The rebuilt server was driven end to end through the real handlers with
  `confirm: true`: `create-deployment` with both target guards → `get-deployment` polled to
  `CREATE_SUCCESSFUL` → `list-deployment-actions` → `run-deployment-action` `PowerOff` then `PowerOn`,
  each with all five `expected*` guards → `delete-deployment` with all four → polled to `404`.

Two disposable deployments (`zz-vcfo088-1`, `zz-vcfo088-2`) were created, one per pass, and each removal
was confirmed by `get-deployment` answering `404` **and** by `list-deployments` (bare and
`projectId`-scoped) showing the environment's exact starting count of one.

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-catalog-items` / `get-catalog-item` | Verified | One released item; `type` renders as `VMware Aria Automation Templates`; the empty schema renders no `Request inputs` block and the absent `isRequestable` no `Requestable:` line. |
| `list-deployments` / `get-deployment` | Verified | Both renderers print real names; the project name resolves through the project service exactly as on 9.1 (no `projectName` on the wire). |
| `list-deployment-actions` | Verified | Bare array of ten actions: `ChangeLease`, `ChangeOwner`, `ChangeProject`, `Delete`, `EditDeployment`, `EditTags`, `PowerOff`, `PowerOn`, `RebuildVMs`, `Update`. No `inputParameters` or `inputs` on any of them. |
| `create-deployment` | Verified | `confirm: false` refuses before any HTTP. Wrong `expectedCatalogItemName` and wrong `expectedProjectName` each refuse after their read. With matching guards the request answered `200` and the tool printed the deployment ID and name (pass B). |
| `run-deployment-action` | Verified | Wrong `expectedActionName`, wrong `expectedStatus` and wrong `expectedProjectName` each refuse after their read. `PowerOff` and `PowerOn` both submitted with all five guards; each answered a `PENDING` request that reached `SUCCESSFUL` in about 30 s. |
| `delete-deployment` | Verified, defect found and fixed | Wrong `expectedName` refuses. With all four guards the delete answered `200` with the queued `Deployment.Delete` request; the deployment read `DELETE_INPROGRESS` for 46–51 s and then `404`. |

### Observed wire shapes

Every shape that VCF Automation 9.1 has also served matches it (VCFO-074) unless noted. The two
`DeploymentRequest` bullets are **vRA 8.18 observations only**: no 9.1 round has submitted a day-2 action
or recorded the delete body, so neither matrix is evidence for the other there.

- `GET /catalog/api/items` — Spring page (`content`, `totalElements`, `totalPages`, `last`, `first`,
  `number`, `size`, `numberOfElements`, `pageable`, `sort`, `empty`). **`size` came back `20` for a
  request of `size=100`**: the catalog service caps the page. The pager stops on `last`/`totalPages`, so
  a larger catalog would be traversed page by page; only one page has been observed here.
- `GET /catalog/api/items/{id}` — `bulkRequestLimit` (`1`), `createdAt`, `createdBy`, `description`,
  `externalId`, `iconId`, `id`, `lastUpdatedAt`, `lastUpdatedBy`, `name`, `projectIds`, `schema`, `type`.
  **Serves neither `isRequestable`, `sourceProjectId` nor `global`**, all three of which 9.1 serves.
  `schema.properties` and `schema.required` were both empty for this blueprint.
- `POST /catalog/api/items/{id}/request` — `200`, a **bare array** of `{deploymentId, deploymentName}`.
  Identical to 9.1, which settles the shape question left open on the issue.
- `GET /deployment/api/deployments/{id}` — the same nineteen keys as 9.1, `description` present only once
  set (the request's `reason`), **no `projectName`**. Status: `CREATE_INPROGRESS` for about four minutes
  (244 s and 224 s) → `CREATE_SUCCESSFUL`; after a delete, `DELETE_INPROGRESS` → `404` with body
  `{"message":"No value present","statusCode":404}`. **A day-2 action does not move it**: the deployment
  read `CREATE_SUCCESSFUL` throughout both power actions.
- `GET /deployment/api/deployments/{id}/actions` — bare array; elements carry exactly `actionType`
  (`RESOURCE_ACTION`), `description`, `displayName`, `id`, `name`, `valid`.
- `POST /deployment/api/deployments/{id}/requests` — **vRA 8.18 only, not yet observed on 9.1.** `200`, a
  `DeploymentRequest`: `id`, `name` (`Power
  Off` / `Power On`), `actionId`, `deploymentId`, `requestedBy`, `status`, `details`, `createdAt`,
  `updatedAt`, `totalTasks`, `completedTasks`, `resourceIds`, `cancelable`. Read back at
  `GET /deployment/api/requests/{id}`, `approvedAt` appears once started and `cancelable` disappears once
  finished. Status vocabulary: `PENDING` or `INITIALIZATION` at submission → `INPROGRESS` → `SUCCESSFUL`,
  4 tasks, about 30 s.
- `DELETE /deployment/api/deployments/{id}` — **`200` with a `DeploymentRequest` body** (`actionId:
  Deployment.Delete`, `status: PENDING`, two `resourceIds`), not an empty `204`. The client had discarded
  it. **vRA 8.18 only**: the 9.1 round saw the same `DELETE_INPROGRESS` → `404` sequence but did not
  record the body.

### Defect found and fixed in this round

- **`delete-deployment` reported `deleted successfully` for a deletion that had only been queued.** The
  service answers with a `PENDING` request and the deployment remains, as `DELETE_INPROGRESS`, for close
  to a minute. `deleteDeployment` now returns that request and the tool reports the deletion as
  *requested*, with the request ID and status, and names `get-deployment` (to `404`) and
  `list-deployments` (to absence) as the confirmation. `run-deployment-action`'s success text now derives
  its next step from the action and the request's status: a power action is not tracked by
  `get-deployment`, a `Deployment.Delete` is (poll to `404`), and a request that is not in a running
  state is reported as held or finished rather than as something to wait for. Both tools render the
  request through one shared set of lines. VCFO-094 subsequently added `get-deployment-request` for
  that lookup; its post-sweep verification status is recorded above.

### Not exercised here

- `inputs` on `create-deployment` and on `run-deployment-action`: the blueprint declares none and no
  action serves an input description. A catalog item with inputs is what would settle both.
- A catalog of more than 20 items, which is where the page cap above would matter.
- A failed provision (`CREATE_FAILED`) and the delete of one.

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

`import-configuration-file` needs a genuine `.vsoconf` container, which no environment tested can produce.
See [VCFO-074](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/170). The catalog and deployment
items are no longer open on this platform: the VCFO-088 round above settled their shapes and the three
writes here, and VCFO-074 had already settled the shapes on VCFA 9.1, where deployments have also been
provisioned and destroyed. What VCFO-088 left unexercised is listed at the end of its section.

Earlier narrowing by VCFO-074 against a VCFA 9.1 lab, kept for the record:

- **A 9.x `.vsoconf` export is not the way out after all.** vRO 9.1 answers the artifact request with
  `406` exactly as vRA 8 does — every artifact `Accept` refused, `*/*` returning JSON — on a standalone
  appliance and on an appliance-embedded orchestrator alike, while workflow, action and package exports
  answer `200 application/zip` on those same hosts in the same session. The refusal is therefore specific
  to configuration elements, not to vRA 8, and `import-configuration-file` has no genuine container to be
  fed from any environment tested. The `406` is now reported as an actionable refusal everywhere, not
  only in `vra8` mode.
- **The configuration attribute key no longer branches by platform.** VCFA 9.1 accepts the plural
  `attributes` on `POST /configurations` and `PUT /configurations/{id}` alike, with the stored values
  confirmed by read-back, so the singular `attribute` vRA 8 rejects is no longer sent anywhere. The
  `vra8` rows above are unaffected: that platform was already being sent the plural key.
