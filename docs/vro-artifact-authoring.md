# vRO Artifact Authoring Notes

These notes capture the practical details learned while adding workflow artifact import/export and creating the `List VMs by Project Name` workflow. Use this as the fast path for future workflow/action work.

## Workflow Artifact Format

- A `.workflow` file is a ZIP archive.
- The archive contains:
  - `workflow-info` — a Java **properties** file (not XML). vRO writes the fixed keys `type=workflow`, `version=2.0`, `charset=UTF-16`, `unicode=true`, `creator=www.dunes.ch`, and `owner=`. The workflow's own id/name/version live in `workflow-content`, **not** here.
  - `workflow-content` — the workflow XML.
  - `input_form_` — only present when the workflow exposes inputs (UI-startable). Inputless workflows omit it and rely on the in-workflow `<presentation>`.
- `workflow-content` is XML encoded as **UTF-16BE** with a big-endian BOM (`0xFE 0xFF`). A little-endian BOM (`0xFF 0xFE`) is rejected by live import.
- The `workflow-content` XML **declaration must be `<?xml version='1.0' encoding='UTF-8'?>`** (single quotes, `UTF-8`) — exactly what vRO writes, even though the bytes are UTF-16BE (the BOM drives decoding). The VCF 9.x Orchestrate **editor returns a 500 when opening** a workflow whose declaration says `encoding="UTF-16"`, even though import and execution succeed.
- `input_form_` is JSON encoded as UTF-16BE with a BOM. It holds both the `layout` (form) and the `schema`; the schema mirrors the workflow inputs, so keep them in sync (the builder generates the schema from the inputs).
- The XML root looks like:
  - `<workflow xmlns="http://vmware.com/vco/workflow" ... root-name="..." object-name="workflow:name=generic" id="..." version="..." api-version="6.0.0" editor-version="2.0" ...>`
  - Use `editor-version="2.0"` and do **not** emit `allowed-operations` on authored workflows. The value `allowed-operations="vf"` is vRO's read-only marker for locked Library workflows; emitting it makes the Orchestrate editor treat the workflow as locked, so it shows *Details* instead of *Open* and returns a 500 when opened. Set `object-name` to lowercase `workflow:name=generic`; vRO normalizes it on export.
- User-facing inputs/outputs are **bare** `<param name="..." type="..."/>` elements (no `<description>` child — descriptions belong in `<presentation>`/`input_form_`; a `<param>` description combined with the workflow `<description>` breaks the editor). Inputs live under `<input>`, outputs under `<output>`.
- Scriptable tasks are `<workflow-item type="task">` nodes with a non-empty `<description>` and a `<script encoded="false"><![CDATA[...]]></script>` body.
- Every item — the start node, each task, and the end item — needs a **distinct `<position>`**. If items overlap (all at `0,0`, which happens when positions are omitted) the editor's schema renderer fails. Lay them out left-to-right with increasing `x`.
- Flow is chained via `out-name`: each task points to the next item, and the final task points to an explicit terminal item `<workflow-item name="..." type="end" end-mode="0">` that carries an empty `<in-binding/>`. Do **not** put `end-mode="1"` on a task — live import rejects scaffolds that lack an explicit `type="end"` item.
- Prefer native vRO action workflow items when a workflow step only executes one existing action. Avoid wrapping a single action in a scriptable task that only calls `System.getModule(...)`.
- Use scriptable tasks when the item performs multiple action calls or additional orchestration logic such as validation, branching, input shaping, or result aggregation.
- Prefer horizontal workflow layouts: arrange sequential items left-to-right with increasing `x` positions and stable `y` positions unless a branch needs vertical separation.
- Task input/output bindings must connect workflow parameters to script variables:
  - `<in-binding><bind name="projectName" type="string" export-name="projectName"/></in-binding>`
  - `<out-binding><bind name="vms" type="Array/Properties" export-name="vms"/></out-binding>`

## Workflow Input Forms

Workflows intended to start from the vRO UI need a valid `input_form_` entry. The MCP scaffold builder generates this automatically from workflow inputs.

Valid package/exported input form shape:

```json
{
  "layout": {
    "pages": [
      {
        "id": "page_general",
        "sections": [
          {
            "id": "section_inputs",
            "fields": [
              {
                "id": "message",
                "display": "textField",
                "signpostPosition": "right-middle",
                "state": { "visible": true, "read-only": false }
              }
            ]
          }
        ],
        "title": "General"
      }
    ]
  },
  "schema": {
    "message": {
      "id": "message",
      "type": { "dataType": "string" },
      "label": "Message",
      "constraints": { "required": true }
    }
  },
  "options": { "externalValidations": [] },
  "itemId": ""
}
```

Important compatibility notes:

- Section objects must contain only `id` and `fields`; put the visible title on the page, not the section.
- Field objects should use `id`, `display`, `signpostPosition`, and `state`. Avoid unverified properties such as `size`.
- Field IDs must match keys in `schema`.

### Supported input-form type mapping

The scaffold builder maps each workflow input type to a verified `schema.<id>.type.dataType` and layout `display`. Types outside this table are **rejected** by `scaffold-workflow-file` and `preflight-workflow-file` rather than silently becoming a `string`/`textField` (which would mismatch `workflow-content` and break the start page).

| vRO input type | `type.dataType` | `display` |
| --- | --- | --- |
| `string` | `string` | `textField` |
| `boolean` | `boolean` | `checkbox` |
| `number` | `decimal` | `decimalField` |
| `SecureString` | `secureString` | `passwordField` |
| `Date` | `dateTime` | `dateTime` |
| `Properties` | `complex` (repeating `key`/`value` strings, `isMultiple: true`) | `datagrid` |
| `Any` | `reference` (`referenceType: "Any"`) | `textField` |
| Reference type (contains `:`, e.g. `VC:VirtualMachine`) | `reference` (with `referenceType`) | `valuePickerTree` |
| `Array/<supported>` (element must itself be supported) | `array` (with `itemType`) | `multiValuePicker` |

The non-obvious rows (`Date` → `dateTime`, `Properties` → `complex`/`datagrid`, `Any` → `reference`) were read back from a vRO-authored form via **package** export — workflow content export drops `input_form_`, but package export preserves it. Other types (namespace-less plugin scalar types, etc.) are not yet mapped: they fail preflight until a verified `dataType`/`display` is added to the table in `src/client/workflow-artifact.ts`. Do not work around a rejection by changing the input type to `string`.

### Form ↔ input cross-check

`preflight-workflow-file` (and `preflight-package` for `input_form_` entries nested inside a `.workflow`) compares the form against the inputs declared in `workflow-content`:

- A form schema key / field with no matching workflow input is an **error** (a stale or hand-edited form).
- A declared workflow input with no form field is a **warning** (the form may be intentionally partial).
- A form `type.dataType` that disagrees with the input's expected mapping is a **warning**.

`preflight-workflow-file` and `preflight-package` also validate `input_form_` entries and fail on the section/field shapes known to break the vRO start page.

## Import And Export Endpoints

Use the official vRO content endpoints:

- Export workflow artifact:
  - `GET /vco/api/content/workflows/{workflowId}`
  - `Accept: application/zip`
- Import workflow artifact:
  - `POST /vco/api/workflows?categoryId={categoryId}&overwrite={true|false}`
  - Body is multipart `FormData` with a `file` part containing the `.workflow` artifact.
  - Do not set `Content-Type` manually for multipart uploads; let `fetch`/`FormData` set the boundary.
- Export action artifact:
  - `GET /vco/api/actions/{actionId}`
  - `Accept: application/zip`
  - Save as `.action`.
- Import action artifact:
  - `POST /vco/api/actions`
  - Body is multipart `FormData` with `file` and `categoryName`.
- Update an action in place:
  - `PUT /vco/api/actions/{actionId}`
  - JSON body is the full action representation (`name`, `module`, `script`, `output-type`, `input-parameters`). The response is a validation envelope (`{ "errors": [] }`), not the action, so re-fetch with `GET` to read the updated action. Verified against vRO 9.1.
- Export configuration artifact:
  - `GET /vco/api/configurations/{id}`
  - Save as `.vsoconf`.
- Import configuration artifact:
  - `POST /vco/api/configurations`
  - Body is multipart `FormData` with `file` and `categoryId`.

The MCP tools implemented for this are:

- `export-workflow-file`
- `import-workflow-file`
- `preflight-workflow-file`
- `export-action-file`
- `import-action-file`
- `preflight-action-file`
- `update-action` (in-place change of an existing action; see below)
- `export-configuration-file`
- `import-configuration-file`
- `preflight-configuration-file`
- `preflight-package`

They read/write files only under their configured artifact directories:

- `VCFA_ARTIFACT_DIR/workflows`
- `VCFA_ARTIFACT_DIR/actions`
- `VCFA_ARTIFACT_DIR/configurations`

Advanced users can override individual directories with `VCFA_WORKFLOW_DIR`, `VCFA_ACTION_DIR`, or `VCFA_CONFIGURATION_DIR`.

## File Safety Pattern

Match the package/resource import-export safety model:

- Require a plain relative file name, not a path.
- Reject absolute paths.
- Reject path separators and traversal.
- Require the artifact extension for the target type: `.workflow`, `.action`, `.vsoconf`, `.package`, or `.zip` as applicable.
- Reject symlink import sources.
- Reject symlink export targets.
- Reject existing export targets unless `overwrite: true`.
- Verify real paths remain under the configured artifact root for that artifact type.

The shared helper is `resolveFileInDirectory(rootDir, fileName, label, envName)` in `src/client/files.ts`.

## Workflow Runtime Patterns

Useful vRO script idioms:

```javascript
var hosts = Server.findAllForType("VRA:Host");
var project = VraEntitiesFinder.getProjects(host);
var machines = VraEntitiesFinder.getMachines(host);
var machinesViaAction = System.getModule("com.vmware.library.vra.infrastructure.machine").getAllMachines(host);
var props = new Properties();
props.put("name", "value");
```

Use `System.getModule(...).actionName(...)` inside a scriptable task only when the script needs to coordinate multiple action calls or perform additional logic. For a single action call, author a native vRO action workflow item and bind its inputs/output directly.

Historical built-in action observed during one live validation session:

- `com.vmware.library.vra.infrastructure.machine/getAllMachines`
- Script: `return VraEntitiesFinder.getMachines(host)`
- Input: `host (VRA:Host)`
- Return: `Array/VRA:Machine`

Do not reuse live IDs from historical notes. Action details must be rediscovered in the target environment with MCP:

- `list-actions` with a filter
- `get-action` by ID

### Action create / update / discovery

- To author a brand-new action use `create-action`. To change an existing one, prefer `update-action` (it edits in place via `PUT /actions/{id}`, preserving the ID); `create-action` refuses a duplicate `module`/`name` and points you to `update-action`. Use the export → edit `.action` → `import-action-file` round-trip when you need a file-level change or to move an artifact between environments.
- vRO does not expose action modules as queryable categories: `list-categories` with `type: "ActionCategory"` returns nothing. Discover existing modules from the `module` column of `list-actions` instead. For `import-action-file`, `categoryName` is the target module name (a new module is created on import).
- The exported `.action` artifact (`action-content`) does **not** carry the module — only `name`, `result-type`, and `id`. The module is set by the `categoryName` you pass to `import-action-file`, so the same artifact can be imported into any module. (`get-action` reports the resulting module authoritatively.)
- The `/actions` list endpoint returns only `id`, `name`, `description`, `fqn`, and `version` — no `module` attribute — and ignores server-side `conditions`/`maxResult` query parameters. So `list-actions` retrieves the full set, applies the name `filter` client-side, and derives each `module` from the `fqn`, which is `"<module>/<name>"` (slash-separated, e.g. `com.vmware.library.snmp/createSnmpQuery`).

## Robust vRO Script Helpers

When writing portable workflow scripts, include small helper functions:

- `toText(value)` for null-safe string conversion.
- `normalize(value)` for trimmed, case-insensitive matching.
- `getField(object, fieldName)` that tries both direct property access and Java-style getter methods.
- `asArray(value)` that accepts arrays and common paged response shapes like `content`, `items`, or `documents`.

This matters because vRO objects can expose properties differently depending on whether they are native scripting objects, plugin objects, or API wrapper objects.

## List VMs By Project Name Workflow

Implemented workflow:

- Name: `List VMs by Project Name`
- ID: `fd370e68-24bc-4bb3-96cc-1e105fc9a516`
- Category: `VCFA`
- Category ID: `7080802d9c4478cd019c447a56c302e8`
- Input:
  - `projectName (string)`
- Outputs:
  - `vms (Array/Properties)`
  - `vmCount (number)`

Runtime behavior:

- Trim and validate `projectName`.
- Auto-select first `VRA:Host`, sorted by name/id.
- Resolve project by exact case-insensitive name.
- Fail clearly when no project matches.
- Fail clearly when multiple normalized names match.
- Use `VraEntitiesFinder.getMachines(host)` through the built-in library action/finder.
- Filter machines by `projectId` first, with `projectName` fallback.
- Return one `Properties` object per matched machine with:
  - `id`
  - `name`
  - `status`
  - `powerState`
  - `projectId`
  - `projectName`
  - `deploymentId`
  - `deploymentName`
  - `owner`
  - `address`

Historical live validation on 2026-04-30:

- `projectName = "MainPrj"` completed successfully.
- It returned `vmCount = 4` from the VRA machine inventory.
- `list-deployments` showed 5 deployments in the same project, but the extra deployment was not returned by `VraEntitiesFinder.getMachines(host)`.
- Deployment-aware fallback paths were attempted in the artifact, but this vRO runtime did not expose deployment listing through the tested scripting APIs.
- Blank `projectName` failed with `projectName is required.`
- Unknown project failed with `Project not found: __does_not_exist__`.

Treat these validation results as an example of the checks to run, not as a portable environment contract. Different VCFA/vRO environments can expose different projects, host names, plugin object shapes, and inventory coverage.

## Validation Commands

Fast local checks:

```bash
npm test
```

Before uploading local artifacts, run the matching preflight tool:

- `preflight-workflow-file` checks `.workflow` ZIP structure, the `workflow-info` properties file, UTF-16BE `workflow-content`, an explicit `type="end"` terminal item, UTF-16BE `input_form_` JSON when present, parameters, bindings, task flow, vRO type syntax, action references, and local import path safety. It also emits **warnings** (non-blocking) for shapes that import and run but make the VCF 9.x editor fail to *open* the workflow: an `encoding="UTF-16"` XML declaration, `<param>` `<description>` children, missing/overlapping item `<position>`s, an end item without `<in-binding/>`, and tasks without a `<description>`.
- `preflight-action-file` checks `.action` ZIP/path safety and parses recognizable XML metadata conservatively.
- `preflight-configuration-file` checks `.vsoconf` ZIP/path safety and parses recognizable XML metadata conservatively.
- `preflight-package` checks `.package`/`.zip` import safety, inspects nested `.workflow`, `.action`, and `.vsoconf` artifacts when they are present, and validates package element `input_form_` entries.

The import tools run the same preflight checks and fail locally before authentication or multipart upload when blocking errors are found.

Useful live MCP sequence:

1. `preflight-workflow-file` with `fileName`.
2. `import-workflow-file` with `categoryId`, `fileName`, `overwrite: true`, `confirm: true`.
3. `list-workflows` filtered by workflow name.
4. `get-workflow` to verify inputs/outputs.
5. `run-workflow` with inputs and `confirm: true`.
6. `get-workflow-execution` to poll status and inspect outputs/errors.

Workflow files are read from the `workflows` subdirectory of `VCFA_ARTIFACT_DIR` (defaults to `artifacts/workflows/` in the MCP server process working directory, typically the open project) unless `VCFA_WORKFLOW_DIR` overrides it.

## Common Pitfalls

- `create-workflow` creates only an empty workflow shell; use authored artifacts and the project package publish flow for real reusable workflow content.
- Do not use a plain scriptable task solely to invoke one action; use a native action workflow item for that case. Scaffold it directly with `scaffold-workflow-file` by passing a task of `kind: "action"` (`module`, `actionName`, ordered `inputs`, and `resultBinding`). In exported XML this is still a `type="task"` item, but it has `script-module="<module>/<actionName>"`, a generated `actionResult = System.getModule("<module>").<actionName>(...)` script, and an `out-binding` from `actionResult` to the workflow output. Omit `resultBinding` for an action with no return value (the scaffold then emits the bare call with no `actionResult`).
- Avoid vertical-only layouts for simple linear workflows; horizontal layouts are easier to scan and match project conventions.
- Do not omit `input_form_` for workflows with user inputs that should be started from the vRO UI.
- Do not add `title` to input form sections or unverified properties like `size` to fields; vRO can reject the start page with schema validation errors.
- `.workflow` `workflow-content` must be UTF-16BE with a big-endian BOM, `workflow-info` must be the Java properties file (not XML), and the workflow must terminate in an explicit `<workflow-item type="end">`; live import rejects any of these defects with `400 "Not a valid workflow file"`.
- Multipart imports break if `Content-Type` is set manually without the boundary.
- `VRA:Machine` inventory and VCFA deployments are not always a one-to-one match.
- Workflow execution starts asynchronously; always poll `get-workflow-execution`.
- vRO script errors surface with item line numbers, so keep generated script readable.
- Action imports use category/module name (`categoryName`), while workflow and configuration imports use category IDs.
