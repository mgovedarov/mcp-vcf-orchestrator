# VCF Automation Verification Matrix

Per-tool status of the default `VCFA_TARGET_PLATFORM=vcfa` platform, from the full-surface live
sweep run under VCFO-086.

**Environment:** VCF Automation 9.1 with the **appliance-embedded** vRO 9.1.0, provider session
(`VCFA_ORGANIZATION=system`), 2026-09-15.
**Topology:** `VCFA_VRO_HOST` unset — every vRO row below is scoped to the embedded orchestrator.
The split-host external-vRO path keeps its own evidence under
[VCFO-081](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/182) and was **not** exercised here.
**Inventory:** 548 workflows, 598 actions, 135 workflow categories, 2 configuration categories,
45 resource categories, 0 action categories, 2 configuration elements, 11 resource elements,
25 packages, 22 plugins.

204 calls were made through the real MCP tool handlers over stdio. The environment was returned to
its exact starting counts afterwards.

This matrix covers `vcfa` only. For `VCFA_TARGET_PLATFORM=vra8`, see the
[vRA 8 Verification Matrix](./vra8-verification-matrix.md) — its "Verified" column is evidence for
vRA 8.18 / vRO 8.18.1 and must not be read as 9.x evidence, just as this one must not be read as
vRA 8 evidence.

## How to read the status column

| Status | Meaning |
| --- | --- |
| **Verified** | Called live in this sweep and the rendered result was checked against the environment, not merely for a 2xx. |
| **Verified under `<code>`** | Confirmed on a 9.1 lab by earlier issue-scoped work, typically from a tenant session. Not re-measured here, and not a gap. |
| **Blocked by identity** | A provider session cannot reach the service. The refusal was confirmed; the functional path was not reachable. |
| **Unverifiable here** | The call path works but this environment cannot supply the input or confirm the result. |
| **Defect** | A defect this sweep found. |

A 200 on an empty list is **not** a pass. Every captured result was also grepped for `undefined`,
`[object Object]`, `NaN`, `(id: )` and for leaked secrets. There were no `[object Object]`, `NaN`
or `(id: )` matches; every `undefined` match was either a schema-validation message from a
deliberately malformed call or a built-in action *description* containing the word. No password
and no bearer token appeared in 227 captured files.

## vRO list semantics on 9.1

Measured directly against the API, because the client's request count alone cannot distinguish
server-side filtering from a client-side post-filter. **These differ from vRA 8** and the
difference is load-bearing for several rows below.

| Endpoint | `conditions` | `maxResult` | `startIndex` | `queryCount` |
| --- | --- | --- | --- | --- |
| `/workflows` | **honored**, case-insensitive | **honored** | **ignored** | **400** — `isQueryCount is not implemented for the type` |
| `/actions` | ignored | ignored | n/a | honored |
| `/packages` | ignored | ignored | n/a | honored |
| `/configurations` | ignored | ignored | n/a | honored |
| `/resources` | ignored | ignored | n/a | honored |

Consequences:

- `/workflows` filtering is **server-side** on 9.1, unlike vRA 8 where `conditions` was ignored
  everywhere. A filtered `list-workflows` costs two requests.
- `queryCount=true` on `/workflows` is a hard 400. The client absorbs it by retrying without the
  parameter, which is why every workflow listing costs two requests rather than one.
- `startIndex` is ignored on `/workflows`: pages requested at 0, 100 and 200 return identical
  content. The repeated-page guard therefore fires on an unfiltered listing and
  `listWorkflowsFromCategories` runs (~137 requests), which is what produces the true 548. On this
  platform that fallback is the normal path, not an edge case.
- The four endpoints that ignore `conditions` confirm **VCFO-073's client-side post-filter is
  load-bearing on 9.1 too** — measured here, not carried over.

## Workflows

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-workflows` | Verified | 548 bare; `filter` matches server-side, and case matters not at all: `mail` and `MAIL` both → 4; `limit` honored. |
| `list-workflows-by-category` | Verified | `categoryName: "Mail"` → 7 workflows with the resolved category id. |
| `get-workflow` | Verified | Inputs, outputs and types rendered, including a four-type scaffolded contract. |
| `create-workflow` | Verified | Created in a disposable category; `confirm: false` refuses first. |
| `run-workflow` | Verified | Started an execution and returned `State: running` with the polling pointer; `expectedWorkflowName` honored. |
| `run-workflow-and-wait` | Verified | Completed and returned `greeting (string): "hello vcfo086 x3"`. Input validation names every missing required input before running. |
| `list-workflow-executions` | Verified | Bare and with `status: "completed"`. `workflowId` is required. |
| `get-workflow-execution` | Verified | State, timings and owner; polled an async execution to completion. |
| `get-workflow-execution-logs` | Verified | Inline per level, and file export in `json`. A no-op workflow legitimately yields 0 log lines. |
| `export-workflow-file` | Verified | Exported; `overwrite: false` refuses an existing file. |
| `scaffold-workflow-file` | Verified | string, number, boolean and Date inputs plus a scriptable task; `inputForms: 1`. |
| `preflight-workflow-file` | Verified | Passes live exports and scaffolds. Warns that the end item lacks an `<in-binding/>` on a live export. |
| `diff-workflow-file` | Verified | All three modes: file/file, live/file, live/live. The discriminator key is `source`; the live variant takes `workflowId`. |
| `import-workflow-file` | Verified | **A scaffolded container imports, opens and runs on vRO 9.1.0** — see VCFO-060 below. An `expectedCategoryName` mismatch refuses before importing. Note it reports that `overwrite` defaulted to true when the flag is omitted. |
| `delete-workflow` | Verified | Guard mismatch refuses; a clean workflow deletes. The `409 Conflict` reported in [#192](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/192) reproduces but is **transient, not terminal** — see [The 409 on delete](#the-409-on-delete-vcfo-087) below. `force: true` sends `?force=true` and deletes such an element immediately. |

## Actions

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-actions` | Verified | 598 bare; `filter` post-filters client-side, which is correct because `/actions` ignores `conditions`. |
| `get-action` | Verified | Accepts a UUID **and** a fully qualified name; script omitted behind a sha256 summary by default and returned with `includeScript`. |
| `create-action` | Verified | Created with input parameters; **creates the module implicitly** — `com.example.zz086` did not exist. Takes `moduleName`, not `module`. |
| `update-action` | Verified | Carries input parameters forward when only `script` is supplied, confirmed by read-back. |
| `export-action-file` | Verified | By fully qualified name — the VCFO-076 fix holds on 9.1. |
| `preflight-action-file` | Verified | Passes live exports. |
| `diff-action-file` | Verified | live/file and file/file; the live variant takes `actionId`. |
| `import-action-file` | Unverifiable here | Only the `confirm: false` refusal was exercised; the module-creation behaviour VCFO-079 measured on 8.18.1 was not re-tested on 9.1. |
| `delete-action` | Verified | Deletes cleanly, including straight after `delete-package` with `deleteContents: false` (the sequence [#192](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/192) reports) — the 409 was never observed on `/actions` here. `force` is wired identically to `delete-workflow`; the flag's effect on this route is therefore untested. |

## Configuration elements

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-configurations` | Verified | `filter` post-filters client-side. |
| `get-configuration` | Verified | **VCFO-080 confirmed on 9.1**: renders `setting (string): "probe-1"`, the scalar, not the raw vRO envelope. The built-in `BatchAction` valueless `Array/Action` attributes render `(no value)`, not `undefined`. |
| `create-configuration` | Verified | Created in the built-in `Additions` category with the plural `attributes` key. |
| `update-configuration` | Verified | Write confirmed by reading the element back (`"probe-2"`), not inferred from the 2xx. `expectedName` mismatch refuses. Performs one non-mutating read *before* the confirm gate, by design. |
| `export-configuration-file` | Expected refusal | **406**, reported as the actionable refusal naming the project-package route — VCFO-074 confirmed on 9.1, identical to vRA 8. |
| `preflight-configuration-file` | Verified (local) | Validates ZIP/XML safety without contacting the server. It accepted a package zip merely renamed to `.vsoconf`, so **a local pass does not imply live import would accept the container** — the same caveat as on vRA 8. No genuine `.vsoconf` exists to feed it, because the export is refused. |
| `import-configuration-file` | Unverifiable here | Same root cause as on vRA 8: no vRO tested serves a `.vsoconf` for a single element, and a package stores elements as `elements/<id>/data`. Only the `confirm: false` refusal was exercised. |
| `delete-configuration` | Verified | Guard mismatch refuses; correct guard deletes, including straight after `delete-package` with `deleteContents: false` — the 409 was not observed on `/configurations` here either. `force` is wired identically; its effect on this route is untested. |

## Resource elements

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-resource-elements` | Verified | 11 bare; `filter` post-filters client-side; `gif` matched 2 of 11. |
| `export-resource-element` | Verified | Exported a binary element. |
| `import-resource-element` | Verified | Creates a new element. |
| `update-resource-element` | Verified | Succeeds with `expectedName`. **VCFO-077 behaves identically on 9.1**: the live record reports no category, so `expectedCategoryName` refuses with the explanatory message rather than a bogus mismatch. |
| `delete-resource-element` | Verified | Guard mismatch refuses; correct guard deletes. |

## Packages

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-packages` | Verified | 25 bare; `filter` post-filters client-side. |
| `get-package` | Verified | Name and description. |
| `create-package` | Verified | Requires a fully qualified name. |
| `export-package` | Verified | — |
| `preflight-package` | Verified, with a caveat | Reports `workflowArtifacts: 0` for a real vRO package, with an accurate warning — the scanner looks for nested artifacts while vRO stores `elements/<id>/data`. The vRA 8 caveat reproduces on 9.1. |
| `get-package-import-details` | Verified | Certificate and content flags; runs preflight internally despite `readOnlyHint: true`. |
| `import-package` | Verified | With `expectedPackageName`. |
| `delete-package` | Verified, with a defect nearby | Deletes with the guard. `deleteContents: false` orphans its members — see [#192](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/192). |
| `ensure-project-package` | Verified | `createIfMissing` + `confirm` creates. Resolves the package live *before* the confirm gate, by design. |
| `add-workflow-to-project-package` | Verified | — |
| `add-action-to-project-package` | Verified | By `categoryName` + `actionName`. |
| `add-configuration-to-project-package` | Verified | — |
| `add-resource-to-project-package` | Verified | — |
| `rebuild-project-package` | Verified | Four elements in the rebuilt package. It is the only destructive tool with no `expected*` guard. |
| `export-project-package` | Verified | — |
| `get-project-package-import-details` | Verified | 4 elements. |
| `import-project-package` | Verified | Guard mismatch refuses; correct guard imports. |

## Categories, plugins, context, promotion

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-categories` | Verified | `WorkflowCategory` 135, `ConfigurationElementCategory` 2, `ResourceElementCategory` 45, `ActionCategory` **none** — modules come from the `module` column of `list-actions`. `filter` post-filters client-side. The resource-category count differs from the vRA 8 lab's 27; that is a content difference between environments, not a behavioural one. |
| `list-plugins` | Verified | 22, each with name, version and description. |
| `collect-context-snapshot` | Verified | Default profile; truncation is visible as explicit `Skipped` counts. `vcfa://context/latest` resolves. The `fileBaseName` argument rejects `../`, absolute and nested names before any HTTP. |
| `prepare-artifact-promotion` | Verified | `workflow`, `action` and `package`. The argument is `kind`, not `artifactType`. For an action it correctly reports the ready import call as unavailable without `target.categoryName`. |

## Automation services — blocked by this identity

A provider session carries no tenant context, so none of these is functionally reachable. The
refusal itself was **confirmed on 9.1**, not assumed: project-service answers `403`, and the
catalog, deployment, blueprint, event-broker and subscription services answer `500`. Two of the
500 bodies name the underlying cause, a refused `rbac-service/api/auth-context` call. Every one
carries the hint naming `VCFA_ORGANIZATION` and stating that vRO works on either session
(VCFO-085).

Every mutating tool below was additionally driven at `confirm: false` and refused before any HTTP.
None was driven with `confirm: true`.

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-projects` / `get-project` | Verified under VCFO-065 | `$filter` accepted and applied on a 9.1 tenant session; 9.x role arrays rendered. Blocked by identity in this sweep — `403` confirmed. |
| `list-catalog-items` / `get-catalog-item` | Verified under VCFO-074 | A released catalog item was read on a 9.1 lab and renders correctly. Blocked by identity here — `500` confirmed. |
| `list-deployments` / `get-deployment` / `list-deployment-actions` | Blocked by identity | `500` confirmed. **No deployment has ever been observed on any lab, on either platform**, so the deployment item shape remains assumed; the `(unnamed)` fallback means a mismatch would degrade visibly. |
| `create-deployment` / `delete-deployment` / `run-deployment-action` | Not exercised | These provision or destroy real infrastructure ([VCFO-084](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/188)). Deliberately excluded from this sweep; only the `confirm: false` refusals were driven. `create-deployment` has since gained `expectedCatalogItemName` / `expectedProjectName` and the destructive annotation (VCFO-084); those are covered by unit tests and **still await live exercise**, which needs a tenant session. |
| `list-templates` / `get-template` | Blocked by identity | `500` confirmed. |
| `create-template` / `delete-template` | Blocked by identity | `500` confirmed; writes keep their vRA 8 verification under VCFO-070. |
| `list-event-topics` | Blocked by identity | `500` confirmed. |
| `list-subscriptions` / `get-subscription` | Blocked by identity | `500` confirmed. |
| `create-subscription` / `update-subscription` / `delete-subscription` | Not exercised | Subscriptions fire on real events in a live tenant; excluded by scope. Writes keep their vRA 8 verification under VCFO-070. |

## Automation services — tenant session, 2026-09-16 (VCFO-074)

The rows above are scoped to the **provider** identity, which cannot reach these services at all.
This section is a separate round on the same 9.1 appliance with a **tenant** session
(`VCFA_ORGANIZATION=<tenant slug>`), and it is the first time a live deployment has existed on any
lab, on either platform. It does not replace the provider rows; both are true of their own identity.

**Environment:** VCF Automation 9.1, tenant session, 2026-09-16. One released catalog item
(`Basic Alpine VM`, a blueprint-backed `com.vmw.blueprint`), one project, two pre-existing
deployments belonging to the environment's owner.
**Topology:** `VCFA_VRO_HOST` was **set** for this org, and **zero `/vco/api` requests were made** —
every service in this round (catalog, deployment, project, blueprint) is pinned to `VCFA_HOST`. A
set-but-unused variable is not split-host evidence, so the "Still open" item below stands unchanged.
**Provisioning:** three deployments were created and destroyed. The environment was returned to its
exact starting count of two, confirmed by polling each to `404` **and** by `list-deployments`.

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-catalog-items` / `get-catalog-item` | Verified | Released item listed and read. The item serves `schema`, `sourceProjectId`, `bulkRequestLimit`, `isRequestable`, `externalId` and `global`, and serves neither `sourceType` nor `sourceName`. |
| `list-deployments` / `get-deployment` | Verified | **The deployment item shape is now observed rather than assumed.** Both renderers print a real name; no `(unnamed)` anywhere in the captures. |
| `list-deployment-actions` | Verified | **The service serves the bare-array arm**, not a Spring page. Five deployment-level actions. |
| `create-deployment` | Verified, defect found and fixed | Provisioned three times. The `expectedCatalogItemName` and `expectedProjectName` guards (VCFO-084) were exercised live for the first time, both arms. The response shape defect below was found here. |
| `delete-deployment` | Verified, defect found and fixed | Deprovisioned three times, each polled to `404`. The `expectedName`, `expectedProjectId` and `expectedStatus` guards all match live. `expectedProjectName` was the defect below. |
| `run-deployment-action` | Guards verified; no action submitted | The `expectedActionName` and `expectedStatus` mismatch arms both refuse correctly, and `expectedProjectName` now matches. **No day-2 action was submitted** — out of scope for this round. |
| `list-projects` / `get-project` | Verified | Reachable on this identity; `get-project` is what resolves the deployment's project name. |
| `list-templates` | Verified | Lists the backing blueprint. |

### Observed wire shapes

`GET /deployment/api/deployments/{id}` serves: `id`, `name`, `description`, `orgId`,
`catalogItemId`, `catalogItemVersion`, `blueprintId`, `blueprintVersion`, `iconId`, `createdAt`,
`createdBy`, `ownedBy`, `ownerType`, `lastUpdatedAt`, `lastUpdatedBy`, `leaseGracePeriodDays`,
`inputs`, `projectId`, `status`. **There is no `projectName`.** `description` appears only when set —
the create request's `reason` becomes it.

`GET /deployment/api/deployments/{id}/actions` serves a **bare array**, whose elements carry `id`,
`name`, `displayName`, `description`, `valid` and `actionType` (`RESOURCE_ACTION`). None carried
`inputParameters` or `inputs`, so the three-way input handling in `formatDeploymentActions` **remains
unobserved everywhere** and must not be assumed correct.

`POST /catalog/api/items/{id}/request` answers a **bare array** of `{deploymentId, deploymentName}` —
not a `Deployment`, and carrying neither `id`, `name` nor `status`.

Deployment status vocabulary observed: `CREATE_INPROGRESS`, `CREATE_SUCCESSFUL`, `DELETE_INPROGRESS`,
then `404`. Note `INPROGRESS` carries **no underscore**.

### Defects found and fixed in this round

- **`create-deployment` returned no identifiers.** The client typed the catalog request response as a
  single `Deployment` and read `.id` / `.name` / `.status` off it, all of which are absent from the
  array the service actually serves, so the tool printed a bare `Deployment request submitted.` The
  caller then had to recover the id from `list-deployments` by name — ambiguous the moment two
  deployments share one. `normalizeCatalogItemRequest` now accepts both the array and the
  single-object arm and both key spellings, and the tool prints the id and name.
- **`expectedProjectName` refused every call on `delete-deployment` and `run-deployment-action`.**
  Both compared the expected value straight against `deployment.projectName`, which 9.1 never serves,
  so the guard reported `found (missing)` and refused — the VCFO-077 defect class, reintroduced
  through a field that was assumed rather than observed. The name is now taken from the deployment
  when a platform serves it and otherwise resolved through the project service, matching how
  `guardCreateDeploymentTarget` already did it.
- **`get-catalog-item` never rendered the request schema.** The wire serves `schema.properties` and
  `schema.required` — the input contract for `create-deployment` — and the tool rendered neither, so
  an agent driving a deployment through the MCP surface had to guess the inputs.

## Settled by this run

- **VCFO-060 holds on VCF Automation 9.1.** A scaffolded `.workflow` — string, number, boolean and
  Date inputs, a scriptable task and a generated input form — preflighted, imported, opened and
  **ran** on the embedded vRO 9.1.0, returning its declared output.
- **The vRO list semantics above are measured, not inherited.** `/workflows` filters server-side on
  9.1 and ignores `startIndex`; the other four endpoints ignore `conditions` and `maxResult`
  entirely, which is what makes VCFO-073's client-side post-filter necessary here too.
- **All three API-version modes work.** Unset auto-probes to `9.1.0` via `GET /api/versions`;
  `vcfa9.1` and `vcfa9.0` both pin and skip discovery, and both serve requests successfully. This
  evidences the `vcfa9.0` **pin mechanism** only — no 9.0 environment was available, so that
  platform remains generalized rather than verified.
- **The safety surface holds.** 32 of 34 `confirm` gates refuse before any HTTP request; the two
  exceptions, `update-configuration` and `ensure-project-package`, perform a deliberate
  non-mutating read first so the confirm prompt can name the target. Every `expected*` mismatch
  returned `isError` with "No live mutation was performed." Path traversal — `../`, absolute and
  nested names — was rejected on every export tool and on `collect-context-snapshot`.
- **`confirm` is a required boolean, not optional.** Omitting it is an MCP-layer validation error,
  which is a different failure mode from the handler's refusal; the two should not be conflated
  when reading a result.

## Still open

- **The split-host `VCFA_VRO_HOST` path was not exercised.** This sweep ran against the embedded
  orchestrator by choice. VCFO-081's own evidence stands, but no full-surface run has been made
  against an external vRO.
- **The Automation-service surface needs a tenant session.** Twenty tools are blocked by the
  provider identity. *Partly resolved:* the tenant round of 2026-09-16 above covers the catalog,
  deployment, project and template tools. The event-broker and subscription tools are still
  unexercised on a 9.x tenant session.
- **A deployment day-2 action has never been submitted.** The `run-deployment-action` guard paths are
  verified live, but no action has been run on any platform, so the request envelope and the
  `DeploymentRequest` response shape remain assumed. A deployment action's input shape
  (`inputParameters` vs `inputs`) has never been observed either — 9.1 served neither.
- **`import-configuration-file` remains unverifiable on any platform tested**, for the same reason
  as on vRA 8: nothing serves a genuine `.vsoconf` container.
- **One defect found:** [#192](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/192)
  (VCFO-087) — elements orphaned by `delete-package` with `deleteContents: false` are undeletable
  through the server, which exposes no `force` option.

## The 409 on delete (VCFO-087)

[#192](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/192) reported that an element left
behind by `delete-package` with `deleteContents: false` becomes undeletable: vRO answers

```
409 Conflict — DELETE /workflows/<id>
{"message":"Workflow '<name>' is in use. Specify '?force=true' parameter to delete it."}
```

A dedicated re-run on 2026-09-15 (same environment as the sweep above: VCF Automation 9.1,
appliance-embedded vRO 9.1.0, provider session) reproduces the 409 but **contradicts both of the
issue's characterizations**. It is neither deterministic nor permanent.

| Measurement | Result |
| --- | --- |
| Plain delete immediately after `delete-package` (`deleteContents: false`) | `409` in **4 of 8** runs |
| The same, after a 5-second pause | `409` in **0 of 4** runs |
| Plain retry after a `409`, timed to clearance | Succeeded at **2.3s, 2.2s, 2.3s** (3 of 3) |
| Plain retry within roughly a second of a `409` | Still `409` |
| Element in a package that **still exists** (added, rebuilt), zero delay | `409` in **0 of 4** runs |
| Element never added to any package (control) | Deleted cleanly |
| `force: true` after a `409` | Deleted immediately |

The mechanism is that vRO releases a package's members asynchronously: for roughly two seconds after
the package is deleted the element is still reported as in use. Membership in a package that still
exists does not trip it, and no element was ever permanently stuck. `delete-action` and
`delete-configuration` ran the identical sequence and never produced a `409` at all, so the
`force` flag is untested on those two routes.

**Consequence for operators:** retry the plain delete before reaching for `force`. `force` skips
vRO's reference check rather than establishing that nothing references the element, so using it to
get past a refusal that a retry would have cleared can silently break a real reference. The flag
remains correct for an element that is genuinely referenced — a case this environment did not
produce.

The environment was returned to its exact starting counts (548 workflows, 598 actions, 25 packages,
2 configuration elements).
