# Live Smoke Tests

Use this checklist to validate the MCP server against a real sandbox or disposable VCF Automation/vRO environment. Keep this separate from local validation: `npm run validate` checks the repository and must not contact VCFA.

Run live smoke tests only where it is acceptable to create, run, package, import, or delete disposable test assets. Use harmless workflows and test categories/packages. Review the exact target, expected impact, and rollback path before setting `confirm: true` on any live mutation. Use `VCFA_IGNORE_TLS=true` only in lab environments where you accept the TLS risk.

## Environment Setup

Unless a section says otherwise, this checklist targets the default
`VCFA_TARGET_PLATFORM=vcfa` platform (VCF Automation 9.x). The `vRA/vRO 8 Compatibility Mode`
section below covers `vra8`.

Configure the required connection variables:

```bash
VCFA_HOST=...
VCFA_USERNAME=...
VCFA_ORGANIZATION=...
VCFA_PASSWORD=...
```

Two dimensions change what a run actually covers, so record both alongside the results:

- **Identity.** `VCFA_ORGANIZATION=system` is a provider session. It reads vRO normally but
  cannot reach the tenant-scoped Automation services — project-service answers `403` and the
  catalog, deployment, blueprint, event-broker and subscription services answer `500` (VCFO-085).
  The catalog, deployment, template, subscription, event-topic and project tools therefore need a
  tenant organization.
- **vRO topology.** With `VCFA_VRO_HOST` set, only `/vco/api` goes to the external appliance while
  the login, `GET /api/versions` and the Automation services stay on `VCFA_HOST` (VCFO-081). Unset,
  everything runs against the appliance-embedded orchestrator. A vRO result is only evidence for
  the topology it ran under.

```bash
# Optional: point the vRO half at an external appliance
VCFA_VRO_HOST=...
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

## VCF Automation 9.x Notes

Behaviour measured on 9.1 under VCFO-086; see the
[VCF Automation Verification Matrix](./vcfa-verification-matrix.md) for the per-tool record.

List semantics differ from vRA 8 and change what a `filter` result proves:

- `/workflows` applies `conditions` **server-side** and case-insensitively, and honors
  `maxResult`, but **ignores `startIndex`** and rejects `queryCount=true` with a `400`. An
  unfiltered `list-workflows` therefore trips the repeated-page guard and falls back to a
  category traversal of roughly 137 requests — that is the normal path on this platform, not a
  fault. A filtered listing is cheap.
- `/actions`, `/packages`, `/configurations` and `/resources` ignore `conditions` and `maxResult`
  entirely and return the full inventory, so the VCFO-073 client-side post-filter is what makes
  `filter` work there.

Two mutating tools perform one non-mutating read **before** the `confirm` gate, by design, so the
prompt can name the target: `update-configuration` and `ensure-project-package`. Every other
mutating tool refuses without reaching the network.

`export-configuration-file` answers `406` on 9.1 exactly as on vRA 8; route the element through
`add-configuration-to-project-package` and `export-project-package` instead.

Check the API version the client settles on, which is logged once per authentication:

```text
[vro-client] Negotiated VCF Cloud API version 9.1.0 via GET /api/versions
```

`VCFA_TARGET_PLATFORM=vcfa9.1` and `vcfa9.0` pin the version and skip that probe.

### Deployment lifecycle (9.x, tenant session)

This is the only sequence in this document that **provisions and destroys real infrastructure**.
It needs a tenant session — a provider session cannot reach the catalog or deployment service at
all — disposable assets, and explicit user confirmation of the catalog item, project, inputs and
expected cost before any `confirm: true`. `delete-deployment` is the only removal path and is
itself a destructive day-2 operation rather than an undo.

Rendered tool output cannot settle a shape question: a missing key renders `(unnamed)`, which says
nothing about the real key, and both arms of the `DeploymentActionList` union render an identical
`Found N deployment action(s)`. So this sequence is driven through the MCP tools **and** mirrored
by raw authenticated `GET`s that record the wire keys. Dump keys only, never bodies.

Discovery first, which is also the go/no-go gate:

```text
list-projects()
get-project(id: "<project-id>")
list-catalog-items()
get-catalog-item(id: "<catalog-item-id>")
list-deployments()
list-deployments(projectId: "<project-id>")
```

If the catalog holds nothing released to the project, **stop before any write** — that is a blocked
run, not a settled one. Record the starting counts; the run must return to them. Deployment
`inputs` come from the catalog item's schema or the blueprint, never guessed.

Refusals and target guards next, none of which mutates anything:

```text
create-deployment(..., confirm: false)
delete-deployment(id: "<deployment-id>", confirm: false)
run-deployment-action(..., confirm: false)
create-deployment(..., expectedCatalogItemName: "zz-wrong", confirm: true)
create-deployment(..., expectedProjectName: "zz-wrong", confirm: true)
```

The three `confirm: false` calls must refuse before any HTTP request. The two mismatches *do*
reach the network, for the guard's own non-mutating read — a distinction worth recording, because
the "refuses before any HTTP" claim in the verification matrix is about the first class only.

Then the provision, the reads, and teardown:

```text
create-deployment(catalogItemId: "...", deploymentName: "zz-smoke-<date>", projectId: "...",
                  inputs: {...}, expectedCatalogItemName: "...", expectedProjectName: "...",
                  confirm: true)
get-deployment(id: "<deployment-id>")            # poll to a terminal status
list-deployments(projectId: "<project-id>")
list-deployment-actions(deploymentId: "<deployment-id>")
delete-deployment(id: "<deployment-id>", expectedName: "zz-smoke-<date>", confirm: true)
```

Points that decide whether the run proves anything:

- **Capture the create response.** The client types it as a single deployment object. If the route
  answers with a list of request objects instead, the tool prints no identifiers and the ID has to
  be recovered from `list-deployments` — record which happened.
- **Record the full status vocabulary observed.** `Deployment.status` is a loose string and the
  declared examples are informed guesses.
- **Mirror `get-deployment` and `list-deployment-actions` with raw `GET`s.** These two are what
  settle the item shape and which arm of the action-list union the service serves.
- **The delete's success message is not evidence of removal.** The client discards the response
  body, so it reports only a 2xx on an asynchronous route. Confirm by polling `get-deployment` to a
  404 *and* by the project-scoped list no longer showing it.
- **Omit `expectedStatus` from the teardown delete** if any day-2 action was submitted: the
  deployment moves through transient states and a spurious refusal during teardown is the worst
  time to discover that.
- `CREATE_FAILED` is **not** a reason to skip teardown — the record exists and may hold allocated
  resources.

Grep every capture for `undefined`, `[object Object]`, `NaN`, `(id: )` and for leaked secrets, and
add **`(unnamed)`** for this run specifically: here a hit is not noise, it is the key-mismatch
finding itself.

If teardown does not reach absence, say so explicitly with the deployment ID, name, project and
last status, and record that live infrastructure is still allocated. Never write that an
environment returned to its starting counts when it did not.

### Cleanup trap

`delete-package` releases its members asynchronously, and for roughly two seconds afterwards vRO
still reports them as *in use* and answers a delete with `409`. Re-measured under VCFO-087, that
refusal is transient rather than permanent: a plain retry cleared it in every timed sample, and
nothing was ever permanently stuck — which is the opposite of what
[#192](https://github.com/mgovedarov/mcp-vcf-orchestrator/issues/192) reported.

So **retry the delete first**. `delete-workflow`, `delete-action` and `delete-configuration` also
take `force`, which sends vRO's own `?force=true`, but that skips a reference check that is doing
real work — reach for it only for an element that is genuinely referenced, never to clear a
refusal a retry would have cleared. Deleting disposable elements **before** the package that
contains them, or deleting the package with `deleteContents: true`, still avoids the race
entirely.

## Provisioning A Deployment (VCFO-074)

This round provisions and destroys **real infrastructure**, and `delete-deployment` is itself a
destructive day-2 operation rather than an undo. It needs disposable assets and explicit
confirmation per [safety](./safety.md). It also needs a **tenant** session: a provider
(`VCFA_ORGANIZATION=system`) session cannot reach the catalog or deployment services at all, which
answer `500` (VCFO-085). The identity, not the credentials, is the gate.

Build first. The rig spawns `dist/index.js`, and a stale build silently tests the previous
signature — the likeliest way this round produces a wrong answer.

### Go/no-go gate

Run the reads first and record the starting counts:

```text
list-projects()
list-catalog-items()
get-catalog-item(id: "<catalog-item-id>")
list-deployments()
list-deployments(projectId: "<project-id>")
```

- A `403`/`500` here means the session is still provider-shaped. The round never started.
- **Zero released catalog items ⇒ stop before any write.** Record it as a blocked round.
- `get-catalog-item` supplies both the exact name the guards will be given **and** the request
  schema the deployment `inputs` must satisfy. Never guess inputs.
- Pin `version` explicitly. A catalog item's input schema changes between released versions, so
  taking the "latest" default can deploy a different contract than the one you recorded.

### Ordered calls

Free calls first, so a late failure still leaves the cheap findings recorded.

1. `create-deployment`, `delete-deployment`, `run-deployment-action` at `confirm: false` — each
   must refuse **before any HTTP**.
2. `create-deployment` with a wrong `expectedCatalogItemName`, then a wrong `expectedProjectName`.
   Unlike the `confirm: false` cases these *do* reach the network for the guard's non-mutating read.
3. **The provision**, with matching expected values and a name marking it disposable.
4. `get-deployment` polled to a terminal status; record the full status vocabulary.
5. `list-deployments` bare and project-scoped with the deployment present.
6. `list-deployment-actions`.
7. `run-deployment-action` guard paths (wrong `expectedActionName`, wrong `expectedStatus`).
   **Submission is a separate decision:** only a benign reversible action the user names
   explicitly, only after all reads are captured, and never `Deployment.Delete` — teardown must go
   through `delete-deployment`, the tool under test.
8. When an action is submitted, capture its request ID and poll `get-deployment-request` to a terminal
  status. Record task progress, timestamps and response keys without printing untyped inputs or
  outputs.

**A free request to read before any write.** `GET /deployment/api/deployments/{id}/requests` and
`GET /deployment/api/requests?deploymentId=<id>` both serve a deployment's request history — a Spring
page on vRA 8.18 and on VCF Automation 9.1 alike (VCFO-095). Reading either for a deployment that
already exists yields a real, terminal request ID, so `get-deployment-request` can be exercised at zero
infrastructure cost before the round decides whether to provision anything. No MCP tool exposes those
listings, which is also the only way to reach a **create** request's ID.

Rendered output cannot settle a wire shape: a `(unnamed)` fallback says nothing about the real key,
and both arms of the `DeploymentActionList` union render identically. A shape question needs a
raw-HTTP key dump alongside the tool calls. Dump **keys only**, never the token or a response body.

### Teardown

Rehearse the guard with a wrong `expectedName` (free), then delete with matching values.

**The success text is not evidence of completion.** `delete-deployment` reports the deletion as
*requested* and prints the `Deployment.Delete` request the service queued (ID and status) when it
returns one — a 2xx on this route means queued, not done. Poll that ID with
`get-deployment-request` when it is present, then confirm resource removal independently by polling
`get-deployment` to a `404` **and** by `list-deployments(projectId)` no longer listing it.

`CREATE_FAILED` is not an excuse to skip teardown — the record exists and may hold allocated
resources. **If teardown fails**, say so immediately with the deployment id, name, project and last
status, and file it. Never write "returned to its exact starting counts" when it did not.

### Captures

Keep every result text, the server stderr, the key dumps, before/after counts and timings. Grep them
for `undefined`, `[object Object]`, `NaN`, `(id: )` and for secrets (count only, never the value).
**Add `(unnamed)` to that grep**: here a hit is not noise, it *is* a key-mismatch finding.

The 2026-09-16 results are recorded in the
[VCF Automation Verification Matrix](./vcfa-verification-matrix.md).

## vRA/vRO 8 Compatibility Mode

For vRA/vRO 8.12+ bearer-token validation, set the platform and use the vIDM domain shown on the Workspace ONE login page as the organization:

```bash
VCFA_TARGET_PLATFORM=vra8
VCFA_ORGANIZATION="System Domain"
```

Read-only checks, safe on any vRA 8 environment:

```text
list-workflows()
get-workflow(id: "<workflow-id>")
list-projects()
list-templates()
list-subscriptions()
list-event-topics()
list-catalog-items()
list-deployments()
run-workflow-and-wait(id: "<workflow-id>", inputs: [], timeoutSeconds: 60, confirm: true)
get-workflow-execution-logs(workflowId: "<workflow-id>", executionId: "<execution-id>", level: "info")
```

The Automation-service list tools return the same shapes as on VCFA 9.x. `list-catalog-items` and `list-deployments` were both empty in the environment VCFO-068 and VCFO-070 verified; VCFO-088 later read a released catalog item and provisioned, inspected, powered off and on, and destroyed a deployment on vRA 8.18, so the catalog item, deployment and deployment-action shapes are confirmed there as well as on VCFA 9.1 (VCFO-074), and the `DeploymentRequest` shape is confirmed there for the first time on any platform. The deployment round described above under **Provisioning A Deployment** applies to this mode unchanged, except that the identity gate is a 9.x concern — here a vIDM user entitled to the catalog item suffices. Both renderers still fall back to `(unnamed)` for a row served without a name, so an unexpected shape degrades visibly instead of printing `undefined`.

The vRO write surface is verified on vRA 8 but still mutates a live environment, so run it only against a disposable category and disposable content, and clean up afterwards:

```text
list-categories(type: "WorkflowCategory")
create-workflow(categoryId: "<disposable-category-id>", name: "zz-smoke", confirm: true)
create-configuration(categoryId: "<disposable-config-category-id>", name: "zz-smoke", attributes: [{ name: "setting", type: "string", value: "probe" }], confirm: true)
delete-workflow(id: "<workflow-id>", confirm: true)
delete-configuration(id: "<configuration-id>", confirm: true)
```

Deleting an element immediately after the package that contained it can answer `409 Conflict`
reporting it as in use. On 9.1 this is transient — vRO releases package members asynchronously and
the state clears in about two seconds — so **retry the plain delete first**. `force: true` sends
vRO's own `?force=true` and is for an element that is genuinely referenced; it skips the reference
check, so do not reach for it to get past a refusal that a retry would clear (VCFO-087).

```text
delete-workflow(id: "<workflow-id>", force: true, confirm: true)
```

Configuration writes send the plural `attributes` key on every platform since VCFO-074, so this mode no longer has an attribute-key difference to check; `PUT /configurations/{id}` still has to carry the element name.

Template and subscription writes are supported in this mode (VCFO-070). They mutate a live environment, so use disposable objects and clean up. Create the subscription **disabled** and **non-blocking**, on a non-blockable topic, so it cannot stall provisioning:

```text
list-projects()
list-event-topics()
create-subscription(
  name: "zz-smoke",
  eventTopicId: "<non-blockable topic id>",
  runnableType: "extensibility.vro",
  runnableId: "<harmless workflow id>",
  blocking: false,
  disabled: true,
  confirm: true
)
update-subscription(id: "<subscription-id>", expectedName: "zz-smoke", description: "changed", confirm: true)
get-subscription(id: "<subscription-id>")     # topic and runnable carried forward
create-template(name: "zz-smoke", projectId: "<project-id>", content: "formatVersion: 1\ninputs: {}\nresources: {}\n", confirm: true)
delete-template(id: "<template-id>", expectedName: "zz-smoke", confirm: true)
delete-subscription(id: "<subscription-id>", expectedName: "zz-smoke", confirm: true)
```

A DRAFT template provisions nothing, but its create and delete do fire `blueprint.configuration`, which the platform's own content-sync subscribers listen on.

Expected unsupported-mode message in this mode:

```text
export-configuration-file(...)
```

It explains that vRA 8 serves a configuration element as JSON only and points at the project-package route. `prepare-artifact-promotion(kind: "configuration", backup: { enabled: true }, ...)` does not fail in this mode: it reports `Backup skipped:` with the same pointer and still returns the preflight report and the import recommendation.

With the disposable configuration element from the write checks, verify the `update-configuration` two-phase flow (both platforms):

```text
update-configuration(id: "<configuration-id>", attributes: [{ name: "setting", type: "string", value: "probe-2" }], confirm: false)   # confirmation prompt naming the element
update-configuration(id: "<configuration-id>", attributes: [{ name: "setting", type: "string", value: "probe-2" }], confirm: true)
get-configuration(id: "<configuration-id>")                                          # description unchanged, value probe-2
update-configuration(id: "<configuration-id>", description: "changed", confirm: false) # refused: would delete the attribute
update-configuration(id: "<configuration-id>", attributes: [{ name: "token", type: "SecureString" }], confirm: false) # refused: empty secret
```

The vRO artifact chains below were all exercised against a vRA 8.18 lab under VCFO-075. Full per-tool
results are in the [vRA 8 Verification Matrix](./vra8-verification-matrix.md).

Discovery note for this mode: `list-categories(type: "ActionCategory")` returns nothing, so action modules
come from the `module` column of `list-actions`. `ResourceElementCategory` does return categories.

Action chain. Export and diff take the action's **element ID**; `get-action` also accepts the fully
qualified name:

```text
list-actions(filter: "<name>")
get-action(id: "<module>/<actionName>", includeScript: true)
create-action(moduleName: "<module>", name: "<actionName>", script: "return 'ok';", returnType: "string", confirm: true)
update-action(id: "<action-id>", expectedName: "<actionName>", expectedModule: "<module>", script: "return 'v2';", confirm: true)
export-action-file(id: "<action-id>", fileName: "probe.action", overwrite: false)
preflight-action-file(fileName: "probe.action")
diff-action-file(
  base: { source: "live", actionId: "<action-id>" },
  compare: { source: "file", fileName: "probe.action" }
)
import-action-file(categoryName: "<module>", fileName: "probe.action", expectedCategoryName: "<module>", confirm: true)
delete-action(id: "<action-id>", expectedName: "<actionName>", expectedModule: "<module>", confirm: true)
```

`import-action-file` requires the target module to **already exist** on vRA 8: an unknown module answers
`404 Action category name not found`. Use `create-action` to establish a new module first. Deleting a
module's last action also removes the module, so a disposable module leaves no residue.

Resource chain. `import-resource-element` always creates a new element (it has no `overwrite`), so a
round-trip adds one that must be cleaned up:

```text
export-resource-element(id: "<resource-id>", fileName: "probe.gif", overwrite: false)
import-resource-element(categoryId: "<resource-category-id>", fileName: "probe.gif", expectedCategoryName: "<category>", confirm: true)
update-resource-element(id: "<new-resource-id>", fileName: "probe.gif", expectedName: "probe.gif", confirm: true)
delete-resource-element(id: "<new-resource-id>", expectedName: "probe.gif", confirm: true)
```

Do not pass `expectedCategoryName` to `update-resource-element` or `delete-resource-element` on vRA 8: the
platform's resource listing carries no category, so the tools refuse with a message saying the value cannot
be verified. Confirm placement with `list-resource-elements` instead.

Direct package chain, on a disposable package:

```text
create-package(name: "com.example.probe", description: "disposable", confirm: true)
export-package(name: "com.example.probe", fileName: "probe.package", overwrite: false)
preflight-package(fileName: "probe.package")
get-package-import-details(fileName: "probe.package")
import-package(fileName: "probe.package", expectedPackageName: "com.example.probe", overwrite: true, confirm: true)
delete-package(name: "com.example.probe", expectedName: "com.example.probe", deleteContents: false, confirm: true)
```

`preflight-package` reports `workflowArtifacts: 0` for a real vRO package and says so in a warning: vRO
packages store elements as `elements/<id>/data`, not as nested `.workflow` / `.action` / `.vsoconf` entries,
so only ZIP and import safety are validated. `get-package-import-details` reports the true element count —
but it runs preflight internally, so it can fail on a package that does not pass.

The remaining project-package adders, beyond the workflow one shown earlier:

```text
add-action-to-project-package(categoryName: "<module>", actionName: "<actionName>", confirm: true)
add-configuration-to-project-package(configurationId: "<configuration-id>", confirm: true)
add-resource-to-project-package(resourceId: "<resource-id>", confirm: true)
import-project-package(expectedPackageName: "<package>", overwrite: true, confirm: true)
```

Discovery and planning tools worth including in a full pass:

```text
list-workflows-by-category(categoryName: "<category>", maxCategories: 10)
collect-context-snapshot(fileBaseName: "probe-ctx", includeOptionalDomains: true, maxItemsPerDomain: 20)
diff-workflow-file(
  base: { source: "live", workflowId: "<workflow-id>" },
  compare: { source: "live", workflowId: "<workflow-id>" }
)
prepare-artifact-promotion(kind: "action", fileName: "probe.action", target: { categoryName: "<module>", actionId: "<action-id>" }, backup: { enabled: true })
prepare-artifact-promotion(kind: "package", fileName: "probe.package", target: { packageName: "<package>" })
```

A scaffolded workflow imports and runs in this mode. Preflight warns that an input parameter "has a
`<description>` child" on any workflow exported unmodified from vRO 8.x — that is a VCF 9.x editor
constraint, not a defect in the exported file.

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
