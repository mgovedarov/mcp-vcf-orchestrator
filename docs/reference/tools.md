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
