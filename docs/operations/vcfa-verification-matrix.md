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

**A later round, VCFO-099 (2026-09-17), covers the two cells this sweep could not.** It ran the full
vRO surface with writes against an **external** vRO over the split-host `VCFA_VRO_HOST` path, and the
remaining Automation-service gaps on a **tenant** session — 276 further calls through the real
handlers, plus a few raw-HTTP key-only probes, both environments restored. Its sections are below; the rows above keep their own scope.

This matrix covers `vcfa` only. For `VCFA_TARGET_PLATFORM=vra8`, see the
[vRA 8 Verification Matrix](./vra8-verification-matrix.md) — its "Verified" column is evidence for
vRA 8.18 / vRO 8.18.1 and must not be read as 9.x evidence, just as this one must not be read as
vRA 8 evidence.

## Post-sweep additions

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-deployment-requests` | Verified under VCFO-097 | Added under VCFO-097 and driven through stdio on a tenant session on 2026-09-17, read-only, against the environment's own two deployments. See the [VCFO-097 section](#deployment-request-listing-tenant-session-2026-09-17-vcfo-097) below. |
| `get-deployment-request` | Verified under VCFO-095 | Pending when it was added under VCFO-094. Driven through stdio on a tenant session on 2026-09-17: **`GET /deployment/api/requests/{id}` does exist on 9.1** and serves the same key set as vRA 8.18. Five real requests plus a 404 and a 400 arm. See the [VCFO-095 section](#deployment-request-lookup-tenant-session-2026-09-17-vcfo-095) below. |
| `import-action-file`, `get-template`, `create-template`, `delete-template` | Verified under VCFO-099 | The four rows the sweep left unverified that an available identity could reach. Driven through stdio on 2026-09-17. |
| `list-event-topics`, `list-subscriptions`, `get-subscription`, `create-subscription`, `update-subscription`, `delete-subscription` | Blocked on both identities under VCFO-099 | Re-measured rather than assumed: `500` on a provider session, `403` on a tenant one. |

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
| `import-action-file` | Verified under VCFO-099 | Both VCFO-079 arms reproduce on 9.1: importing into a module that does not exist answers `404 Action category name not found`, and importing into an existing one succeeds. `create-action` still creates the module implicitly. See the [VCFO-099 split-host section](#split-host-external-vro-provider-session-2026-09-17-vcfo-099). |
| `delete-action` | Verified | Deletes cleanly. **The 409 *does* occur on `/actions`** — VCFO-099 observed it on an external vRO after deleting a package that had been exported and re-imported — and it is transient there too: one plain retry cleared it. This supersedes the sweep's "never observed on `/actions`" reading, which was taken from a shorter-lived package. See [The 409 on delete](#the-409-on-delete-vcfo-087). |

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
| `delete-configuration` | Verified | Guard mismatch refuses; correct guard deletes. **The 409 also occurs on `/configurations`** and clears on one plain retry (VCFO-099). The documented refusals both fire: omitting `attributes` on an element that has some, and a secure attribute sent without a value. |

## Resource elements

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-resource-elements` | Verified | 11 bare; `filter` post-filters client-side; `gif` matched 2 of 11. |
| `export-resource-element` | Verified | Exported a binary element. |
| `import-resource-element` | Verified | Creates a new element. |
| `update-resource-element` | Verified | Succeeds with `expectedName`. **VCFO-077 behaves identically on 9.1**: the live record reports no category, so `expectedCategoryName` refuses with the explanatory message rather than a bogus mismatch. |
| `delete-resource-element` | Verified | Guard mismatch refuses; correct guard deletes. **The 409 occurs on `/resources` too** and clears on one plain retry (VCFO-099). |

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
| `list-catalog-items` / `get-catalog-item` | Verified under VCFO-074 | A released catalog item was read on a 9.1 tenant session and renders correctly; see the tenant-session section below. Blocked by identity here — `500` confirmed. |
| `list-deployments` / `get-deployment` / `list-deployment-actions` | Blocked by identity | `500` confirmed on this identity. The item and action shapes were settled separately on a **tenant** session — see the tenant-session section below (VCFO-074). |
| `create-deployment` / `delete-deployment` / `run-deployment-action` | Not exercised **in this sweep** | These provision or destroy real infrastructure ([VCFO-084](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/188)), so only the `confirm: false` refusals were driven here. All three, and the VCFO-084 target guards, were exercised live on a **tenant** session — see the tenant-session section below (VCFO-074). |
| `list-templates` / `get-template` | Verified under VCFO-099 | Both driven on a 9.x tenant session; `get-template` renders status, project, validity and omits content behind a sha256 summary until `includeContent`. Blocked by identity on a provider session — `500` confirmed. **`list-templates`' `search` is a silent no-op on 9.1** — see the tenant section below. |
| `create-template` / `delete-template` | Verified under VCFO-099 | Both exercised on a 9.x tenant session against a disposable DRAFT blueprint, with all four `delete-template` guard arms. **`create-template` requires non-empty `content` on 9.1**, contradicting its own description — see the tenant section below. Blocked by identity on a provider session — `500` confirmed. |
| `list-event-topics` | Blocked on both identities | `500` on a provider session; **`403` on a tenant session** (VCFO-099, and independently under VCFO-098). Not reachable with either identity this environment offers — see [Event-broker: blocked on both identities](#event-broker-blocked-on-both-identities-2026-09-17-vcfo-099). |
| `list-subscriptions` / `get-subscription` | Blocked on both identities | `500` on a provider session; **`403` on a tenant session** (VCFO-099). |
| `create-subscription` / `update-subscription` / `delete-subscription` | Blocked on both identities | Approved for VCFO-099 and **still not runnable**: `create-subscription` needs an `eventTopicId` from a listing that `403`s, and a `runnableId` the tenant cannot see. Writes keep their vRA 8 verification under VCFO-070. |

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

## Deployment request listing, tenant session, 2026-09-17 (VCFO-097)

`list-deployment-requests` closes the gap the round below recorded: a **create** request's ID was
returned nowhere, so the request that provisioned a deployment was readable by ID and its ID was
undiscoverable. This round drove the new tool through the real handler, per
[VCFO-097](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/218).

**Environment:** VCF Automation 9.1 (negotiated 9.1.0), tenant session, 2026-09-17. The environment's
own two pre-existing deployments in one project: one carrying a single create request, the other a
create plus a `VM Power Off` submitted in an earlier session by another route.
**Topology:** `VCFA_VRO_HOST` was set to this org's external vRO; **no `/vco/api` request was made**, so
every route here is on `VCFA_HOST`. That is not split-host evidence.
**Provisioning: none.** The round is entirely read-only — the listing on a deployment that already
exists yields a real, terminal request ID at zero infrastructure cost. Nothing was created, mutated or
deleted; `list-deployments` reported the same two deployments before and after.

**Method.** A throwaway stdio client on a fresh `dist/index.js`, plus a raw-HTTP key-only dump of both
listings so no key rests on rendered output alone.

| Tool | Status | Evidence |
| --- | --- | --- |
| `list-deployment-requests` | Verified | Both deployments listed. The create request's ID was taken from the listing and read back with `get-deployment-request` — the loop the tool exists to close. `limit: 1` against the two-request deployment returned one row and the "showing the first 1 of 2" notice, so the route honors `size` and its `totalElements` is trustworthy. An absent deployment ID answers `404 {"message":"No value present"}`; the refusal offers both causes a 404 could have rather than asserting the deployment is gone, and names `list-deployments` and `get-deployment-request`. Captures carry no `undefined`, `[object Object]`, `NaN`, `(id: )`, `(unnamed)` or secret. |
| `get-deployment-request` | Verified again | Fed an ID discovered from the listing rather than one returned by a write — the first time that path has been exercised. |

### Observed wire shapes

- `GET /deployment/api/deployments/{id}/requests` — a **Spring page**: `content`, `pageable`,
  `totalElements`, `totalPages`, `last`, `size`, `number`, `sort`, `numberOfElements`, `first`,
  `empty`. `totalElements` matched `content.length` on every unlimited call, and `size=1` returned one
  element with `totalElements` still reporting the full count.
- Each element is the object `GET /requests/{id}` serves. A **day-2** element carried `id`, `name`,
  `requestedBy`, `actionId`, `deploymentId`, `resourceIds`, `status`, `details`, `createdAt`,
  `updatedAt`, `approvedAt`, `totalTasks`, `completedTasks`. A **create** element carried
  `blueprintId`, `catalogItemId` and **`inputs`** in place of `actionId`.
- **The create element's `inputs` were withheld**, verified by grepping the rendered listing for each
  input name the deployment was requested with. The same omission `get-deployment-request` makes, now
  load-bearing on a listing too.
- **Order, observed only:** the two-request deployment listed its `VM Power Off` before its `Create`,
  i.e. newest first. One deployment on one platform is not a contract, so the tool claims no ordering.

### Not exercised here

- **The post-deletion `404`.** Both listings answer `404` once the deployment is gone (VCFO-095), but
  reproducing it through this tool needs a disposable deploy/delete cycle, which this read-only round
  deliberately did not run. The `404` handling itself was exercised against an absent deployment ID and
  is covered by unit tests.
- The `GET /deployment/api/requests?deploymentId=<id>` arm. It exists (VCFO-095) and the tool does not
  send it.

## Deployment request lookup, tenant session, 2026-09-17 (VCFO-095)

The tenant round above provisioned and destroyed deployments but submitted no day-2 action, so nothing
on 9.x had ever produced a `DeploymentRequest`. This round did, on the same appliance and tenant
identity, per [VCFO-095](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/213). **It is the
first day-2 action submitted on 9.x.**

**Environment:** VCF Automation 9.1 (negotiated 9.1.0), tenant session, 2026-09-17. One project, one
released catalog item (`Basic Alpine VM`, four released versions, one required `hostname` input), two
pre-existing deployments belonging to the environment's owner, which were only ever read.
**Topology:** `VCFA_VRO_HOST` was set to this org's external vRO; **no `/vco/api` request was made**,
so every route here is on `VCFA_HOST`. That is not split-host evidence.
**Provisioning:** one disposable deployment (`zz-vcfo095-1`, `version` pinned to `4`) created,
powered off and on, and deleted; `list-deployments` back at the starting count of two, bare and
`projectId`-scoped, and the delete independently confirmed by `get-deployment` answering `404`.

**Method.** A throwaway stdio client on a fresh `dist/index.js`, with a raw-HTTP key-only dump of every
request at one mid-flight and one terminal sample, so no key rests on rendered output alone.

| Tool | Status | Evidence |
| --- | --- | --- |
| `get-deployment-request` | Verified | The route exists and renders identity, requester, status, task progress including a zero numerator, cancelability, timestamps and resource IDs. An unknown UUID answers `404 {"message":"No value present"}`; a non-UUID answers `400` naming the parameter. Captures carry no `undefined`, `[object Object]`, `NaN`, `(id: )`, `(unnamed)` or secret. |
| `run-deployment-action` | **Verified — first submission on 9.x** | `PowerOff` 30 s and `PowerOn` 21 s, each with all five `expected*` guards. The deployment read `CREATE_SUCCESSFUL` throughout both, exactly as on vRA 8.18. |
| `create-deployment` | Verified again | `confirm: false` and a wrong `expectedCatalogItemName` refused first; the provision took 46 s with `inputs` and a pinned `version`. |
| `delete-deployment` | Verified again | A wrong `expectedName` refused first; with all four guards the request reached `SUCCESSFUL` at 29 s and the deployment answered `404` on that same poll. |

### Observed wire shapes

- `GET /deployment/api/requests/{id}` — the **same key set vRA 8.18 serves**: `actionId`, `cancelable`,
  `completedTasks`, `createdAt`, `deploymentId`, `details`, `id`, `name`, `requestedBy`, `resourceIds`,
  `status`, `totalTasks`, `updatedAt`, plus `approvedAt` once started. `cancelable` disappears at
  terminal. **`completedAt` is never served.**
- **Status vocabulary:** `PENDING` → `INITIALIZATION` → `CHECKING_APPROVAL` → **`COMPLETION`** →
  `SUCCESSFUL`, with `INPROGRESS` before `COMPLETION`. `COMPLETION` appears at full task progress and
  still cancelable, one poll before `SUCCESSFUL`. **Read it as a sampling result, not a platform
  difference:** at a 2 s poll interval it was caught on one of this round's three requests, inside a
  window of at most 2 s, and on vRA 8.18 the same interval caught it on none — which cannot distinguish
  a short-lived state from its absence. What is established is that 9.1 serves it. Neither status is a
  member of the tool's non-running set, so the fail-open default kept the guidance correct; the tool's
  own text, which named three active statuses, was corrected in this change.
- **`totalTasks` is a placeholder at submission** — `1` for a power action, `2` for a delete — replaced
  once the service enumerates the tasks (4, 5, and 7 for a create), exactly as on vRA 8.18.
- **A 9.1 create request carries `inputs`**, alongside `blueprintId` and `catalogItemId` and without an
  `actionId`. The tool **withheld every one of them**, verified by grepping the rendered output for each
  input name. This is the first platform where that deliberate omission is load-bearing: the vRA 8.18
  blueprint declared no inputs at all.
- `GET /deployments/{id}/requests` and `GET /requests?deploymentId=` both exist and serve a **Spring
  page**. Neither was exposed by any MCP tool at the time, so a *create* request ID could not be reached
  from the MCP surface; `list-deployment-requests` closes that gap on the deployment-scoped route
  ([VCFO-097](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/218)) and carries its own row
  above. The observation here stays a VCFO-095 raw-HTTP measurement.
- **A request outlives its deployment.** After the delete both listings answer `404`, yet every request
  still reads by ID.
- Platform differences worth recording against vRA 8.18: 9.1 offers **five** deployment-level actions
  rather than ten, the catalog item carries a real input schema, and provisioning is far quicker
  (46 s against 289 s).

### Not exercised here

- `FAILED` and `APPROVAL_PENDING`: not producible benignly, so both remain **assumed** members of the
  non-running set.
- **A cancelled request, deliberately.** `Cancelable: Yes` renders throughout, but this server exposes
  no cancel route, so the field is informative and never actionable through the MCP surface.
- A day-2 action carrying `inputs`: none of the five actions this platform offers declares any.

## Split-host external vRO, provider session, 2026-09-17 (VCFO-099)

The sweep above ran against the **appliance-embedded** orchestrator with `VCFA_VRO_HOST` unset, and
recorded "the split-host `VCFA_VRO_HOST` path was not exercised" as its largest open item. This round
closes it, per [VCFO-099](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/222): the full vRO surface, **writes included**, driven against an **external vRO 9.1** while
authentication and every Automation service stayed on `VCFA_HOST`.

**Environment:** VCF Automation 9.1 (negotiated 9.1.0), provider session, external vRO 9.1.0,
2026-09-17.
**Topology:** `VCFA_VRO_HOST` set **and used**. Unlike the earlier tenant rounds, this is genuine
split-host evidence: every `/vco/api` request was logged with the external host and no other service
was, so the routing is observed rather than inferred from a set variable.
**Inventory (external vRO, provider):** 548 workflows, 598 actions, 135 workflow categories,
3 configuration categories, 28 resource categories, 0 action categories, 3 configuration elements,
10 resource elements, 25 packages, 22 plugins.

**The gate was a measurement, not an assumption.** A provider session writing on an *external* vRO had
never been tried — the tenant identity is refused there (`403 … (Edit, false)`). A disposable
configuration element was created first, and only then did the writes proceed.

| Tool group | Status | Evidence |
| --- | --- | --- |
| Workflows (15) | Verified | A scaffolded four-input container preflighted, imported, opened and **ran**, returning `result (string): "hello vcfo099 x3"` and a real `System.log` line. All three `diff-workflow-file` modes; `expectedCategoryName` and `expectedName` mismatches refuse. Input validation names a bad `number`/`boolean` before running. |
| Actions (9) | Verified | `create-action` creates the module implicitly; `update-action` carries `inputParameters` forward when only `script` is sent, confirmed by read-back; `export-action-file` by FQN. **`import-action-file` closed** — see below. |
| Configuration elements (8) | Verified | Create/read/update/delete with read-back. `SecureString` renders `[redacted]`; vRO coerces `"42"`→`42` and `"true"`→`true`. `export-configuration-file` answers the same `406`. |
| Resource elements (5) | Verified | Export, import, update, delete; VCFO-077's "cannot verify here" message reproduces. |
| Packages (17) | Verified | The whole project-package family against a disposable package: four elements added, rebuilt, exported, import-details read, re-imported both ways. `preflight-package` reports `workflowArtifacts: 0` with its accurate warning. A non-fully-qualified package name is refused. |
| Categories, plugins, context, promotion (4) | Verified | `ActionCategory` still returns nothing. `collect-context-snapshot` default profile works; `prepare-artifact-promotion` for workflow, action and package. |

### Settled by this round

- **Split-host routing is observed.** Every `/vco/api` request carried the external host in its log
  line while the login, `GET /api/versions` and the Automation services stayed on `VCFA_HOST`. The
  startup banner states the split explicitly.
- **A provider session can write on an external vRO.** The tenant identity cannot; the two are not
  interchangeable, and only the provider one is usable for vRO authoring in this topology.
- **`import-action-file` behaves on 9.1 exactly as VCFO-079 measured on 8.18.1.** A module that does
  not exist answers `404 Action category name not found`; an existing one imports. The tool cannot
  create a module, `create-action` can, and deleting a module's last action removes the module, so a
  disposable module leaves no residue — confirmed by the restored category counts.
- **The external and embedded orchestrators are different instances with near-identical built-ins.**
  Identical workflow, action, package and plugin counts; different user content (3 configuration
  elements against 2, 28 resource categories against 45). Do not read one inventory as the other's.
- **The environment was returned to its exact starting counts**, verified by re-listing all nine
  inventories. The disposable workflow category was created and removed by raw HTTP, since no MCP
  tool creates one.

### Not settled here

- `import-configuration-file` — unchanged: no `.vsoconf` exists to feed it.
- `collect-context-snapshot` with `includeOptionalDomains: true` **fails the whole snapshot** on a
  provider session rather than skipping the unreachable domains; the `500` carries the
  `VCFA_ORGANIZATION` hint. Recorded as observed behaviour, not judged.

## Automation services, tenant session, 2026-09-17 (VCFO-099)

Per [VCFO-099](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/222).

**Environment:** VCF Automation 9.1, tenant session, 2026-09-17. One project, one released catalog
item with a single pattern-constrained `hostname` input, one DRAFT blueprint, two pre-existing
deployments belonging to the environment's owner, which were only ever read.
**Provisioning:** one disposable deployment created and deleted; `list-deployments` back at two, and
the delete independently confirmed by `get-deployment` answering `404`.

| Tool | Status | Evidence |
| --- | --- | --- |
| `get-template` | Verified | Renders status, project, validity and timestamps; content is omitted behind a sha256 summary by default and returned with `includeContent`. |
| `create-template` | Verified, with a platform constraint | Created a disposable DRAFT blueprint. **`content` is not optional on 9.1**: omitting it answers `400 {"message":"Unknown Server Validation Error"}`. A minimal `formatVersion: 1` is accepted. The tool's description says an empty template is created when `content` is omitted, which is true on vRA 8 and false here. |
| `delete-template` | Verified | All four `expected*` guards exercised on both arms — name, project ID, project name and status each refuse on mismatch; the correct set deletes. |
| `list-deployment-requests` | Verified — post-deletion `404` closed | The arm VCFO-097 deliberately skipped. After the deployment was deleted the listing answers `404` **through the real handler**, and the refusal names both causes a `404` could have and points at the read that still works. |
| `get-deployment` | Verified again | `404` after deletion, on the same poll that confirmed the delete. |
| `get-deployment-request` | Verified again | **A request outlives its deployment through the MCP surface**: the create request still read `SUCCESSFUL` after the deployment was `404`. Previously only a raw-HTTP measurement. |
| `create-deployment` / `delete-deployment` | Verified again | Provision 37 s, delete 26 s. `confirm: false` and a wrong `expectedCatalogItemName` refuse first; all four delete guards match live. |
| `list-deployment-actions` | Verified | Five deployment-level actions, bare array. |

### Observed on this round

- **`search` is a silent no-op on three Automation list tools.** `list-templates`,
  `list-deployments` and `list-catalog-items` each returned the **full inventory** for a needle that
  matches nothing. The client does send it — `$search=<needle>` was observed on the wire for
  `/blueprints`, `/deployments` and `/items` — so 9.1's services ignore the parameter. The tools
  present `search` as a filter, so a caller asking whether something exists gets a misleading answer.
  `list-projects` is unaffected: it sends an OData `$filter`, which 9.1 does apply (VCFO-065/072).
- **A day-2 action's input shape remains unobserved.** A raw key-only dump of
  `GET /deployments/{id}/actions` on both deployments shows all five actions carrying exactly
  `actionType, description, displayName, id, name, valid` — no `inputParameters`, no `inputs`. The
  three-way handling in `formatDeploymentActions` still must not be assumed correct.
- **A tenant identity is read-only on the external vRO**, and nearly blind: `403 … (Edit, false)` on
  `create-configuration`, 0 workflows and 0 packages visible. The refusal carries the correct
  "authorization, not authentication" hint.

## Event-broker: blocked on both identities, 2026-09-17 (VCFO-099)

Per [VCFO-099](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/222). The subscription and event-topic tools were approved for this round and could not be run. Both
listings were probed on both identities:

| Identity | `GET /topics` | `GET /subscriptions` |
| --- | --- | --- |
| Provider (`VCFA_ORGANIZATION=system`) | `500` | `500` |
| Tenant | **`403`** | **`403`** |

The tenant `403` is not new — VCFO-098's live round recorded the same thing independently — but it
was previously filed against the provider identity alone, so the matrix read as though a tenant
session would resolve it. It does not. The account this environment offers lacks the role the
event-broker requires, and the refusal carries the correct hint saying to check roles rather than
credentials.

**What would unblock it:** granting that account the role the event-broker service requires, then
re-probing with `list-event-topics`. Until then `create-subscription` cannot even be composed — it
needs an `eventTopicId` from a listing that `403`s, and a `runnableId` the tenant cannot see, since
the tenant reads 0 workflows on the external vRO. The six tools keep their vRA 8 verification under
VCFO-069/070 and have **no 9.x evidence of any kind**.

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

- ~~**The split-host `VCFA_VRO_HOST` path was not exercised.**~~ **Closed by VCFO-099** on
  2026-09-17: the full vRO surface, writes included, ran against an external vRO on a provider
  session, with the routing observed on the wire rather than inferred. See the
  [split-host section](#split-host-external-vro-provider-session-2026-09-17-vcfo-099).
- **The event-broker surface has no 9.x evidence at all, and cannot get any here.** Six tools —
  `list-event-topics`, `list-subscriptions`, `get-subscription` and the three subscription writes —
  answer `500` on a provider session and `403` on a tenant one. This is now a measured property of
  both identities rather than a provider-only limitation; it needs an RBAC change, not a different
  session. See [Event-broker: blocked on both identities](#event-broker-blocked-on-both-identities-2026-09-17-vcfo-099).
- **`import-configuration-file` remains unverifiable on any platform tested**, for the same reason
  as on vRA 8: nothing serves a genuine `.vsoconf` container.
- **A deployment action's input shape** (`inputParameters` vs `inputs`) has still never been
  observed. VCFO-099 dumped the raw keys of all five actions on 9.1 and none carries either, which
  makes this a property of the labs available rather than an untried check.
- **`FAILED` and `APPROVAL_PENDING`** request statuses remain assumed members of the non-running set;
  neither is producible benignly.
- **`vcfa9.0` remains a verified pin *mechanism* only** — no 9.0 environment exists.
- **Two defects VCFO-099 found, neither fixed in that round:**
  - [#223](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/223) (VCFO-100) — `search` is a silent no-op on `list-templates`, `list-deployments` and `list-catalog-items` on
    9.1. The client sends `$search`; the services ignore it and return the full inventory, so a
    filtered question gets an unfiltered answer that reads as a match.
  - [#224](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/224) (VCFO-101) — `create-template` describes `content` as optional and says an empty template is created when it
    is omitted. On 9.1 that request answers `400`. The description is correct for vRA 8 only.
- **One defect carried forward:** [#192](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/192)
  (VCFO-087) — see the section below, whose characterization VCFO-099 further narrows.

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
`delete-configuration` ran the identical sequence in that round and never produced a `409`.

**VCFO-099 narrows that last sentence.** On an external vRO on 2026-09-17 the `409` *did* fire on
`/actions`, `/configurations` **and** `/resources`, with the same `is in use. Specify '?force=true'`
body and the same transience: one plain retry cleared each, the slowest at 2.0 s. So the route is not
the discriminator. What distinguished the two rounds was the package: nine zero-delay deletes after
tearing down a package that had only just been built produced **no** `409`, while the elements of a
package that had been exported and re-imported produced one on all three routes. Treat the `409` as
possible on every element route, and keep the operator guidance below unchanged — retry first. **No `409` in this round
needed `force`**: every one cleared on a plain retry. The flag path was exercised separately, on a
`delete-workflow` that was *not* refusing — it deleted and reported that it had forced — so `force`
overcoming a live refusal remains untested on every route.

**Consequence for operators:** retry the plain delete before reaching for `force`. `force` skips
vRO's reference check rather than establishing that nothing references the element, so using it to
get past a refusal that a retry would have cleared can silently break a real reference. The flag
remains correct for an element that is genuinely referenced — a case this environment did not
produce.

The environment was returned to its exact starting counts (548 workflows, 598 actions, 25 packages,
2 configuration elements).
