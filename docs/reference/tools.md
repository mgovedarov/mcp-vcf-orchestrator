# Tool Reference

Tools are grouped by operating domain. Read-only tools are safe for discovery; write and delete tools can modify live VCFA/vRO state or local artifact files.

## Context Snapshots

| Tool | Purpose |
| --- | --- |
| `collect-context-snapshot` | Collect reusable VCFA/vRO context and persist deterministic Markdown and JSON snapshots without dumping secrets, scripts, template YAML, or binary content. |

### collect-context-snapshot parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `fileBaseName` | string | `vcfa-context` | Base file name for the `.json` and `.md` output files. Plain name only — no path separators or extensions. |
| `overwrite` | boolean | `false` | Replace existing snapshot files. |
| `domains` | string[] | core domains | Domains to collect. Core: `workflows`, `actions`, `configurations`, `resources`, `categories`. Optional: `templates`, `catalogItems`, `eventTopics`, `subscriptions`, `packages`, `plugins`. |
| `includeOptionalDomains` | boolean | `false` | Also collect templates, catalog items, event topics, subscriptions, packages, and plugins. |
| `maxItemsPerDomain` | integer | `100` | Maximum items to collect per domain. Increase this when the environment has more than 100 workflows or actions and you need full coverage. Any positive integer is accepted. |

## Artifact Promotion

| Tool | Purpose |
| --- | --- |
| `prepare-artifact-promotion` | Run preflight, optionally export a live backup, summarize risks/changes, and recommend the exact confirmed import call. |

### prepare-artifact-promotion parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `kind` | string (enum) | Yes | Artifact kind: `workflow`, `action`, `configuration`, or `package`. |
| `fileName` | string | Yes | Plain artifact file name under the configured artifact directory for the selected kind. |
| `target` | object | No | Live target details used for diff and the recommended import call. See [target object](#promotion-target-object) below. |
| `overwrite` | boolean | No | Overwrite flag included in the recommended import call (default: `true`). |
| `backup` | object | No | Live backup export settings. See [backup object](#promotion-backup-object) below. |

#### promotion target object

| Field | Type | Description |
| --- | --- | --- |
| `categoryId` | string | Target category ID for workflow or configuration import. |
| `categoryName` | string | Target category name for action import. |
| `workflowId` | string | Live workflow ID to diff against or back up. |
| `actionId` | string | Live action ID to diff against or back up. |
| `configurationId` | string | Live configuration ID to diff against or back up. |
| `packageName` | string | Live package name to back up. |

#### promotion backup object

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | Yes | Whether to export a live backup before promotion. |
| `fileName` | string | No | Override file name for the backup artifact. |
| `overwrite` | boolean | No | Overwrite the backup file if it already exists. |

## Workflows

| Tool | Purpose |
| --- | --- |
| `list-workflows` | List workflows, optionally filtered by name. |
| `get-workflow` | Get workflow details including input/output parameters. |
| `create-workflow` | Create a new empty workflow in a category. |
| `delete-workflow` | Delete a workflow. Irreversible. |
| `run-workflow` | Execute a workflow with optional inputs. |
| `run-workflow-and-wait` | Validate inputs, execute a workflow, wait for completion, and return outputs or diagnostics. |
| `list-workflow-executions` | List past and current executions for a workflow. |
| `get-workflow-execution` | Check execution status and retrieve outputs. |
| `export-workflow-file` | Export a workflow artifact to a `.workflow` file. |
| `scaffold-workflow-file` | Generate a local `.workflow` artifact from structured metadata and scriptable tasks. |
| `preflight-workflow-file` | Validate a local `.workflow` artifact before import. |
| `diff-workflow-file` | Compare local workflow artifacts, or a live workflow export against a local artifact. |
| `import-workflow-file` | Import a `.workflow` artifact into a workflow category. |

### Workflow execution inputs

Both `run-workflow` and `run-workflow-and-wait` accept an optional `inputs` array. Each element:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | Parameter name matching a workflow input parameter. |
| `type` | string | `run-workflow` only | vRO parameter type (e.g. `string`, `number`, `boolean`, `Array/string`). Optional for `run-workflow-and-wait` — inferred from the workflow definition when omitted. |
| `value` | any | Yes | Parameter value compatible with the declared type. |

### run-workflow-and-wait parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | string | — | Workflow ID to execute. |
| `inputs` | array | `[]` | See [Workflow execution inputs](#workflow-execution-inputs). |
| `timeoutSeconds` | integer | `300` | Maximum seconds to wait for completion before returning a timeout result. |
| `pollIntervalSeconds` | integer | `2` | Seconds between execution status polls. |
| `logLimit` | integer | `20` | Maximum log entries to include when the execution fails or times out. Set to `0` to suppress logs. |

### list-workflow-executions parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `workflowId` | string | Yes | Workflow ID. |
| `maxResults` | integer | No | Maximum executions to return (default: `20`). |
| `status` | string (enum) | No | Filter by execution status: `running`, `completed`, `failed`, `canceled`, or `waiting-signal`. |

### scaffold-workflow-file parameters

The required `workflow` object describes the full workflow structure.

#### workflow object

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | Workflow display name. |
| `tasks` | array | Yes | Linear sequence of scriptable tasks (at least one). See [task object](#task-object) below. |
| `id` | string | No | Workflow UUID. Defaults to a generated UUID. |
| `description` | string | No | Workflow description. |
| `version` | string | No | Workflow version (default: `1.0.0`). |
| `apiVersion` | string | No | Workflow API version (default: `6.0.0`). |
| `inputs` | array | No | Workflow input parameters. See [parameter object](#parameter-object) below. |
| `outputs` | array | No | Workflow output parameters. See [parameter object](#parameter-object) below. |
| `attributes` | array | No | Workflow attributes (workflow-scoped variables). See [parameter object](#parameter-object) below. |

#### parameter object

Used for `inputs`, `outputs`, and `attributes`.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | Parameter name. |
| `type` | string | Yes | vRO parameter type (e.g. `string`, `number`, `boolean`, `Array/string`, `Properties`). |
| `description` | string | No | Parameter description. |

#### task object

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `script` | string | Yes | JavaScript body of the scriptable task. |
| `displayName` | string | No | Task display name shown in the vRO UI. |
| `name` | string | No | Internal workflow item name (default: `itemN`). |
| `description` | string | No | Task description. |
| `inBindings` | array | No | Maps workflow inputs or attributes into script variables. See [binding object](#binding-object) below. |
| `outBindings` | array | No | Maps script variables back to workflow outputs or attributes. See [binding object](#binding-object) below. |

#### binding object

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | Script-local variable name. |
| `type` | string | Yes | vRO parameter type. |
| `source` | string | `inBindings` | Workflow input or attribute name to read from. |
| `target` | string | `outBindings` | Workflow output or attribute name to write to. |

### diff-workflow-file sources

Both `base` and `compare` are discriminated unions selected by `source`:

| `source` value | Additional field | Description |
| --- | --- | --- |
| `"file"` | `fileName` (string) | A local `.workflow` file under the configured artifact directory. |
| `"live"` | `workflowId` (string) | Export the live workflow and use it as the comparison side. |

## Actions

| Tool | Purpose |
| --- | --- |
| `list-actions` | List scriptable actions, optionally filtered by name. |
| `get-action` | Get action details including script content and parameters. |
| `create-action` | Create a new action with script content. |
| `export-action-file` | Export an action artifact to a `.action` file. |
| `preflight-action-file` | Validate a local `.action` artifact before import. |
| `diff-action-file` | Compare local action artifacts, or a live action export against a local artifact. |
| `import-action-file` | Import a `.action` artifact into an action category. |
| `delete-action` | Delete an action. Irreversible. |

### create-action parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `moduleName` | string | Yes | Module (package) name for the action (e.g. `com.example.myactions`). |
| `name` | string | Yes | Action name. |
| `script` | string | Yes | JavaScript body of the action. |
| `inputParameters` | array | No | Input parameter definitions. Each element: `{ name, type, description? }`. |
| `returnType` | string | No | Return type (e.g. `string`, `void`, `Array/string`). |

### diff-action-file sources

Same discriminated union as [diff-workflow-file sources](#diff-workflow-file-sources), replacing `workflowId` with `actionId`:

| `source` value | Additional field | Description |
| --- | --- | --- |
| `"file"` | `fileName` (string) | A local `.action` file under the configured artifact directory. |
| `"live"` | `actionId` (string) | Export the live action and use it as the comparison side. |

## Configuration Elements

| Tool | Purpose |
| --- | --- |
| `list-configurations` | List configuration elements, optionally filtered by name. |
| `get-configuration` | Get configuration element details and attributes. |
| `create-configuration` | Create a configuration element with attributes. |
| `update-configuration` | Update a configuration element name, description, or attributes. |
| `export-configuration-file` | Export a configuration artifact to a `.vsoconf` file. |
| `preflight-configuration-file` | Validate a local `.vsoconf` artifact before import. |
| `import-configuration-file` | Import a `.vsoconf` artifact into a configuration category. |
| `delete-configuration` | Delete a configuration element. Irreversible. |

## Resource Elements

| Tool | Purpose |
| --- | --- |
| `list-resource-elements` | List resource elements, optionally filtered by name. |
| `export-resource-element` | Export a resource element by ID to a local file. |
| `import-resource-element` | Import a local resource file into a resource category. |
| `update-resource-element` | Replace an existing resource element's binary content from a local file. |
| `delete-resource-element` | Delete a resource element, optionally forcing deletion when referenced. |

## Categories

| Tool | Purpose |
| --- | --- |
| `list-categories` | List categories by type: `WorkflowCategory`, `ActionCategory`, `ConfigurationElementCategory`, or `ResourceElementCategory`. |

### list-categories parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | string (enum) | Yes | Category type: `WorkflowCategory`, `ActionCategory`, `ConfigurationElementCategory`, or `ResourceElementCategory`. |
| `filter` | string | No | Filter categories by name (substring match). |

## Catalog Items

| Tool | Purpose |
| --- | --- |
| `list-catalog-items` | List available Service Broker catalog items, optionally searched by name. |
| `get-catalog-item` | Get catalog item details including type, source, and project assignments. |

## Deployments

| Tool | Purpose |
| --- | --- |
| `list-deployments` | List deployments, optionally filtered by name/keyword or project ID. |
| `get-deployment` | Get deployment details including status, project, and catalog item info. |
| `create-deployment` | Deploy a catalog item by ID, deployment name, and project ID. |
| `delete-deployment` | Delete a deployment. Irreversible. |
| `list-deployment-actions` | List deployment-level day-2 actions available for a deployment. |
| `run-deployment-action` | Submit a deployment-level day-2 action request. |

## Blueprint Templates

| Tool | Purpose |
| --- | --- |
| `list-templates` | List blueprint templates, optionally filtered by name/keyword or project ID. |
| `get-template` | Get template details including status, project, validity, and YAML content. |
| `create-template` | Create a blueprint template with optional YAML content. |
| `delete-template` | Delete a blueprint template. Irreversible. |

## Packages

| Tool | Purpose |
| --- | --- |
| `list-packages` | List vRO packages, optionally filtered by name. |
| `get-package` | Get details of a package by fully qualified package name. |
| `export-package` | Export a package as a ZIP file. |
| `preflight-package` | Validate a `.package` or `.zip` artifact before import. |
| `import-package` | Import a package file into Orchestrator. |
| `delete-package` | Delete a package after confirmation, optionally deleting contained elements. |

## Plugins

| Tool | Purpose |
| --- | --- |
| `list-plugins` | List installed vRO plugins, optionally filtered by name. |

## Extensibility Subscriptions

| Tool | Purpose |
| --- | --- |
| `list-event-topics` | List available Event Broker topics. |
| `list-subscriptions` | List extensibility subscriptions, optionally filtered by project ID. |
| `get-subscription` | Get subscription details including constraints, blocking, and priority. |
| `create-subscription` | Create a subscription linking an event topic to a vRO workflow or ABX action. |
| `update-subscription` | Update a subscription. |
| `delete-subscription` | Delete a subscription. |

### create-subscription parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | Yes | Subscription name. |
| `eventTopicId` | string | Yes | Event topic ID (use `list-event-topics` to discover available topics). |
| `runnableType` | string (enum) | Yes | Runnable to trigger: `extensibility.vro` (vRO workflow) or `extensibility.abx` (ABX action). |
| `runnableId` | string | Yes | ID of the workflow or ABX action to trigger. |
| `projectId` | string | No | Project ID to scope the subscription. |
| `description` | string | No | Subscription description. |
| `blocking` | boolean | No | Whether the subscription blocks the event pipeline until the runnable completes. |
| `priority` | number | No | Subscription priority. Lower number = higher priority. |
| `timeout` | number | No | Timeout in minutes for runnable execution. |
| `disabled` | boolean | No | Create the subscription in disabled state (default: `false`). |

### update-subscription parameters

All fields except `id` are optional; only supplied fields are updated.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | Subscription ID to update. |
| `name` | string | No | New subscription name. |
| `description` | string | No | New description. |
| `disabled` | boolean | No | Enable (`false`) or disable (`true`) the subscription. |
| `runnableId` | string | No | New workflow or ABX action ID. |
| `runnableType` | string (enum) | No | New runnable type: `extensibility.vro` or `extensibility.abx`. |
| `blocking` | boolean | No | Update blocking behaviour. |
| `priority` | number | No | Update priority. |
| `timeout` | number | No | Update timeout in minutes. |
