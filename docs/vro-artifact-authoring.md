# vRO Artifact Authoring Notes

These notes capture the practical details learned while adding workflow artifact import/export and creating the `List VMs by Project Name` workflow. Use this as the fast path for future workflow/action work.

## Workflow Artifact Format

- A `.workflow` file is a ZIP archive.
- The archive contains at least:
  - `workflow-info`
  - `workflow-content`
- `workflow-content` is XML encoded as UTF-16 with a BOM.
- The XML root looks like:
  - `<workflow xmlns="http://vmware.com/vco/workflow" ... id="..." version="..." api-version="6.0.0">`
- User-facing inputs live under `<input>`.
- Workflow outputs live under `<output>`.
- Scriptable tasks are `<workflow-item type="task">` nodes with a `<script encoded="false"><![CDATA[...]]></script>` body.
- Task input/output bindings must connect workflow parameters to script variables:
  - `<in-binding><bind name="projectName" type="string" export-name="projectName"/></in-binding>`
  - `<out-binding><bind name="vms" type="Array/Properties" export-name="vms"/></out-binding>`

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
- Export configuration artifact:
  - `GET /vco/api/configurations/{id}`
  - Save as `.vsoconf`.
- Import configuration artifact:
  - `POST /vco/api/configurations`
  - Body is multipart `FormData` with `file` and `categoryId`.

The MCP tools implemented for this are:

- `export-workflow-file`
- `import-workflow-file`
- `export-action-file`
- `import-action-file`
- `export-configuration-file`
- `import-configuration-file`

They read/write files only under their configured artifact directories:

- `VCFA_WORKFLOW_DIR`
- `VCFA_ACTION_DIR`
- `VCFA_CONFIGURATION_DIR`

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

Built-in action confirmed in this environment:

- `com.vmware.library.vra.infrastructure.machine/getAllMachines`
- ID: `9d533b42-de3f-4a32-912e-2be46d6bf2de`
- Script: `return VraEntitiesFinder.getMachines(host)`
- Input: `host (VRA:Host)`
- Return: `Array/VRA:Machine`

Action details can be inspected with MCP:

- `list-actions` with a filter
- `get-action` by ID

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

Live validation on 2026-04-30:

- `projectName = "MainPrj"` completed successfully.
- It returned `vmCount = 4` from the VRA machine inventory.
- `list-deployments` showed 5 deployments in the same project, but the extra deployment was not returned by `VraEntitiesFinder.getMachines(host)`.
- Deployment-aware fallback paths were attempted in the artifact, but this vRO runtime did not expose deployment listing through the tested scripting APIs.
- Blank `projectName` failed with `projectName is required.`
- Unknown project failed with `Project not found: __does_not_exist__`.

## Validation Commands

Fast local checks:

```bash
npm test
```

Useful live MCP sequence:

1. `import-workflow-file` with `categoryId`, `fileName`, `overwrite: true`, `confirm: true`.
2. `list-workflows` filtered by workflow name.
3. `get-workflow` to verify inputs/outputs.
4. `run-workflow` with inputs.
5. `get-workflow-execution` to poll status and inspect outputs/errors.

For this repository, set `VCFA_WORKFLOW_DIR` to the directory containing generated `.workflow` files before importing.

## Common Pitfalls

- `create-workflow` creates only an empty workflow shell; use `import-workflow-file` for real workflow content.
- `.workflow` content must preserve UTF-16 encoding with BOM.
- Multipart imports break if `Content-Type` is set manually without the boundary.
- `VRA:Machine` inventory and VCFA deployments are not always a one-to-one match.
- Workflow execution starts asynchronously; always poll `get-workflow-execution`.
- vRO script errors surface with item line numbers, so keep generated script readable.
- Action imports use category/module name (`categoryName`), while workflow and configuration imports use category IDs.
