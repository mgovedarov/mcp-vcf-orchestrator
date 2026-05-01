# MCP Server for VCF Automation Orchestrator

[![npm version](https://img.shields.io/npm/v/@mgovedarov/mcp-vcf-orchestrator)](https://www.npmjs.com/package/@mgovedarov/mcp-vcf-orchestrator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An [MCP](https://modelcontextprotocol.io/) server that exposes VCF Automation Orchestrator (vRO), Service Broker, and Cloud Assembly REST API operations as tools. Enables AI assistants to list, create, delete, and run workflows, actions, configuration elements, resource elements, extensibility subscriptions, catalog items, deployments, blueprint templates, and plugins via natural language.

Supports **VCF 9 Automation** and **Aria Automation 8.x**.

## Prerequisites

- **Node.js** 18.0 or higher
- **VCF Automation** 9.x (or Aria Automation 8.x) instance with REST API access
- Credentials (username, organization, password) for the VCF Cloud API

## Installation

### From npm (recommended)

```bash
npx @mgovedarov/mcp-vcf-orchestrator
```

Or install globally:

```bash
npm install -g @mgovedarov/mcp-vcf-orchestrator
mcp-vcf-orchestrator
```

### From source

```bash
git clone https://github.com/mgovedarov/mcp-vcf-orchestrator.git
cd mcp-vcf-orchestrator
npm install
npm run build
```

## Configuration

Set the following environment variables (see `.env.example`):

| Variable                 | Required | Description                                                                                  |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------- |
| `VCFA_HOST`              | Yes      | VCFA hostname (e.g. `vcfa.example.com`)                                                      |
| `VCFA_USERNAME`          | Yes      | Username without organization (e.g. `admin`)                                                 |
| `VCFA_ORGANIZATION`      | Yes      | Organization/tenant (e.g. `System` or `vsphere.local`)                                       |
| `VCFA_PASSWORD`          | Yes      | Password                                                                                     |
| `VCFA_IGNORE_TLS`        | No       | Set to `true` to skip TLS certificate verification (lab environments)                        |
| `VCFA_ARTIFACT_DIR`      | No       | Root directory for local artifact import/export files (defaults to a temp directory)         |

Artifact files are organized under `VCFA_ARTIFACT_DIR` as `packages`, `resources`, `workflows`, `actions`, and `configurations`. Advanced users can still override individual locations with `VCFA_PACKAGE_DIR`, `VCFA_RESOURCE_DIR`, `VCFA_WORKFLOW_DIR`, `VCFA_ACTION_DIR`, or `VCFA_CONFIGURATION_DIR`.

The server authenticates by POSTing to `https://{VCFA_HOST}/cloudapi/1.0.0/sessions` with Basic Auth as `{VCFA_USERNAME}@{VCFA_ORGANIZATION}:{VCFA_PASSWORD}` and uses the returned bearer token for all VCFA API calls.

## Usage

### Run directly

```bash
VCFA_HOST=vcfa.example.com VCFA_USERNAME=admin VCFA_ORGANIZATION=vsphere.local VCFA_PASSWORD=secret npx @mgovedarov/mcp-vcf-orchestrator
```

### VS Code (GitHub Copilot)

Add to your VS Code `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "vcfa": {
        "command": "npx",
        "args": ["-y", "@mgovedarov/mcp-vcf-orchestrator"],
        "env": {
          "VCFA_HOST": "vcfa.example.com",
          "VCFA_USERNAME": "administrator",
          "VCFA_ORGANIZATION": "vsphere.local",
          "VCFA_PASSWORD": "your-password",
          "VCFA_IGNORE_TLS": "false"
        }
      }
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vcfa": {
      "command": "npx",
      "args": ["-y", "@mgovedarov/mcp-vcf-orchestrator"],
      "env": {
        "VCFA_HOST": "vcfa.example.com",
        "VCFA_USERNAME": "administrator",
        "VCFA_ORGANIZATION": "vsphere.local",
        "VCFA_PASSWORD": "your-password",
        "VCFA_IGNORE_TLS": "false"
      }
    }
  }
}
```

## Tools Reference

### Workflows

| Tool                       | Description                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `list-workflows`           | List workflows, optionally filtered by name                                                 |
| `get-workflow`             | Get workflow details including input/output parameters                                      |
| `create-workflow`          | Create a new empty workflow in a category                                                   |
| `delete-workflow`          | Delete a workflow (irreversible)                                                            |
| `run-workflow`             | Execute a workflow with optional input parameters                                           |
| `run-workflow-and-wait`    | Validate inputs, execute a workflow, wait for completion, and return outputs or diagnostics |
| `list-workflow-executions` | List past and current executions for a workflow, with optional status filter                |
| `get-workflow-execution`   | Check execution status and retrieve outputs                                                 |
| `export-workflow-file`     | Export a workflow artifact to a `.workflow` file under the configured workflow artifact directory |
| `scaffold-workflow-file`   | Generate a local `.workflow` artifact from structured metadata and linear scriptable tasks  |
| `preflight-workflow-file`  | Validate a local `.workflow` artifact before import                                        |
| `diff-workflow-file`       | Compare two local `.workflow` artifacts, or a live workflow export against a local artifact |
| `import-workflow-file`     | Import a `.workflow` artifact from the configured workflow artifact directory into a workflow category |

### Actions

| Tool                 | Description                                                                |
| -------------------- | -------------------------------------------------------------------------- |
| `list-actions`       | List actions (scriptable tasks), optionally filtered by name               |
| `get-action`         | Get action details including script content and parameters                 |
| `create-action`      | Create a new action with script content                                    |
| `export-action-file` | Export an action artifact to a `.action` file under the configured action artifact directory |
| `preflight-action-file` | Validate a local `.action` artifact before import                       |
| `diff-action-file`  | Compare two local `.action` artifacts, or a live action export against a local artifact |
| `import-action-file` | Import a `.action` artifact from the configured action artifact directory into an action category |
| `delete-action`      | Delete an action (irreversible)                                            |

### Configuration Elements

| Tool                        | Description                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `list-configurations`       | List configuration elements, optionally filtered by name                                 |
| `get-configuration`         | Get configuration element details and attributes                                         |
| `create-configuration`      | Create a new configuration element with attributes                                       |
| `update-configuration`      | Update a configuration element's name, description, or attributes                        |
| `export-configuration-file` | Export a configuration artifact to a `.vsoconf` file under the configured configuration artifact directory |
| `preflight-configuration-file` | Validate a local `.vsoconf` artifact before import                                  |
| `import-configuration-file` | Import a `.vsoconf` artifact from the configured configuration artifact directory into a configuration category |
| `delete-configuration`      | Delete a configuration element (irreversible)                                            |

### Resource Elements

| Tool                      | Description                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `list-resource-elements`  | List resource elements, optionally filtered by name                                         |
| `export-resource-element` | Export a resource element by ID to a file under the configured resource artifact directory  |
| `import-resource-element` | Import a resource element file from the configured resource artifact directory into a resource category |
| `update-resource-element` | Replace an existing resource element's binary content from a file under the configured resource artifact directory |
| `delete-resource-element` | Delete a resource element, optionally forcing deletion when it is referenced                |

### Categories

| Tool              | Description                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `list-categories` | List categories by type (`WorkflowCategory`, `ActionCategory`, `ConfigurationElementCategory`, `ResourceElementCategory`) |

### Catalog Items

| Tool                 | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `list-catalog-items` | List available Service Broker catalog items, optionally searched by name |
| `get-catalog-item`   | Get catalog item details including type, source, and project assignments |

### Deployments

| Tool                      | Description                                                                    |
| ------------------------- | ------------------------------------------------------------------------------ |
| `list-deployments`        | List deployments, optionally filtered by name/keyword or project ID            |
| `get-deployment`          | Get deployment details including status, project, and catalog item info        |
| `create-deployment`       | Deploy a catalog item by providing its ID, a deployment name, and a project ID |
| `delete-deployment`       | Delete a deployment (irreversible)                                             |
| `list-deployment-actions` | List deployment-level day-2 actions available for a deployment                 |
| `run-deployment-action`   | Submit a deployment-level day-2 action request with optional inputs and reason |

### Blueprint Templates

| Tool              | Description                                                                     |
| ----------------- | ------------------------------------------------------------------------------- |
| `list-templates`  | List blueprint templates, optionally filtered by name/keyword or project ID     |
| `get-template`    | Get template details including status, project, validity, and full YAML content |
| `create-template` | Create a new blueprint template with optional YAML content                      |
| `delete-template` | Delete a blueprint template (irreversible)                                      |

### vRO Packages

| Tool             | Description                                                                         |
| ---------------- | ----------------------------------------------------------------------------------- |
| `list-packages`  | List vRO packages on the Orchestrator instance, optionally filtered by name         |
| `get-package`    | Get details of a specific package by its fully-qualified name                       |
| `export-package` | Export a package as a ZIP file under the configured package artifact directory       |
| `preflight-package` | Validate a local `.package` or `.zip` artifact before import                    |
| `import-package` | Import a package file from the configured package artifact directory into the Orchestrator instance |
| `delete-package` | Delete a package after confirmation, optionally deleting all its contained elements |

### vRO Plugins

| Tool           | Description                                                                      |
| -------------- | -------------------------------------------------------------------------------- |
| `list-plugins` | List installed plugins on the Orchestrator instance, optionally filtered by name |

### Extensibility Subscriptions

| Tool                  | Description                                                                      |
| --------------------- | -------------------------------------------------------------------------------- |
| `list-event-topics`   | List available event topics from the Event Broker                                |
| `list-subscriptions`  | List extensibility subscriptions, optionally filtered by project ID              |
| `get-subscription`    | Get subscription details including constraints, blocking, and priority           |
| `create-subscription` | Create a new subscription linking an event topic to a vRO workflow or ABX action |
| `update-subscription` | Update a subscription (enable/disable, re-target, change priority)               |
| `delete-subscription` | Delete a subscription                                                            |

## MCP Resources

| Resource URI                     | Description                                     |
| -------------------------------- | ----------------------------------------------- |
| `vcfa://docs/readme`             | README content for tool usage and configuration |
| `vcfa://docs/artifact-authoring` | vRO artifact authoring and import/export guide  |
| `vcfa://workflows/{id}`          | Workflow metadata as JSON                       |
| `vcfa://actions/{id}`            | Action metadata and script details as JSON      |
| `vcfa://deployments/{id}`        | Deployment details as JSON                      |
| `vcfa://packages/{name}`         | vRO package metadata as JSON                    |

## MCP Prompts

| Prompt                         | Description                                                   |
| ------------------------------ | ------------------------------------------------------------- |
| `vcfa-author-workflow`         | Guide workflow authoring, scaffolding, preflight, and import  |
| `vcfa-review-artifact-import`  | Review local artifacts before import                          |
| `vcfa-troubleshoot-deployment` | Inspect a deployment and guide safe remediation               |
| `vcfa-discover-capabilities`   | Discover reusable plugins, categories, actions, and workflows |

## Examples

These examples show developer-oriented prompts you can use with an AI assistant connected to this MCP server. The interesting bit is not just one tool call; it is the assistant chaining discovery, validation, execution, diagnostics, local artifact work, and guarded changes.

### Debug a workflow run without memorizing its schema

```
User: Find the workflow we use to resize a deployment, show me the inputs,
      then run it for deployment dep-123 with size large and wait for the result.

Assistant calls: list-workflows(filter: "resize")
  → Finds candidate workflows and IDs
Assistant calls: get-workflow(id: "...")
  → Reads required input names and vRO types
Assistant calls: run-workflow-and-wait(
  id: "...",
  inputs: [
    {name: "deploymentId", value: "dep-123"},
    {name: "size", value: "large"}
  ],
  timeoutSeconds: 600,
  logLimit: 30
)
  → Validates inputs before running, polls until completion, and returns outputs.
    If the workflow fails, the response includes current item, stack, log excerpts,
    and warnings when diagnostics cannot be fetched.
```

### Scaffold, import, and test a workflow artifact

```
User: Create a simple workflow artifact called Echo Message. It should take
      message as a string and return result as a string. Save it locally,
      import it into the Dev workflows category, and run it once.

Assistant calls: scaffold-workflow-file(
  fileName: "echo-message.workflow",
  workflow: {
    name: "Echo Message",
    inputs: [{name: "message", type: "string", description: "Text to echo"}],
    outputs: [{name: "result", type: "string", description: "Echo result"}],
    tasks: [{
      displayName: "Echo",
      script: "result = message;",
      inBindings: [{name: "message", type: "string", source: "message"}],
      outBindings: [{name: "result", type: "string", target: "result"}]
    }]
  }
)
  → Writes echo-message.workflow under the configured workflow artifact directory as an importable ZIP
    with UTF-16 workflow-content

Assistant calls: list-categories(type: "WorkflowCategory", filter: "Dev")
  → Finds the target workflow category ID
Assistant calls: import-workflow-file(
  categoryId: "<dev-workflow-category-id>",
  fileName: "echo-message.workflow",
  overwrite: true,
  confirm: true
)
  → Imports the local artifact
Assistant calls: list-workflows(filter: "Echo Message")
Assistant calls: run-workflow-and-wait(
  id: "<workflow-id>",
  inputs: [{name: "message", value: "hello"}]
)
  → Returns result: "hello"
```

### Export, review, and promote vRO artifacts safely

```
User: Export the Netbox package and the IPAM workflow before I change them.
      Then import the updated workflow artifact from my local workflow directory.

Assistant calls: list-packages(filter: "netbox")
Assistant calls: export-package(
  name: "com.example.netbox",
  fileName: "com.example.netbox.package",
  overwrite: true
)
  → Saves the package under the configured package artifact directory

Assistant calls: list-workflows(filter: "IPAM")
Assistant calls: export-workflow-file(
  id: "<workflow-id>",
  fileName: "ipam-before-change.workflow",
  overwrite: true
)
  → Saves the current workflow under the configured workflow artifact directory

Assistant calls: import-workflow-file(
  categoryId: "<workflow-category-id>",
  fileName: "ipam-updated.workflow",
  overwrite: true,
  confirm: true
)
  → Uploads only after confirmation and only from the configured workflow artifact directory
```

### Preflight local artifacts before upload

```
User: Validate the updated IPAM workflow artifact before importing it.

Assistant calls: preflight-workflow-file(
  fileName: "ipam-updated.workflow"
)
  → Checks the archive structure, UTF-16 workflow XML, parameters, bindings,
    task flow, vRO type syntax, and local import safety before any upload.
```

### Deploy from the catalog and run day-2 actions

```
User: Find the Ubuntu catalog item, deploy a medium build agent in project
      project-dev-123, then show me the actions available after it is created.

Assistant calls: list-catalog-items(search: "Ubuntu")
  → Lists matching Service Broker catalog items
Assistant calls: get-catalog-item(id: "...")
  → Shows item metadata, source, projects, and useful context
Assistant calls: create-deployment(
  catalogItemId: "...",
  deploymentName: "build-agent-01",
  projectId: "project-dev-123",
  reason: "Temporary CI build agent",
  inputs: {size: "medium", diskGb: 80}
)
  → Deployment request submitted
Assistant calls: list-deployments(search: "build-agent-01", projectId: "project-dev-123")
  → Confirms current deployment state
Assistant calls: list-deployment-actions(deploymentId: "<deployment-id>")
  → Shows day-2 actions and input hints
Assistant calls: run-deployment-action(
  deploymentId: "<deployment-id>",
  actionId: "<power-or-reboot-action-id>",
  reason: "Developer requested reboot after bootstrap",
  confirm: true
)
  → Submits the action only after confirmation
```

### Create a reusable vRO action

```
User: Create a utility action that normalizes deployment names for our
      provisioning workflows.

Assistant calls: create-action(
  moduleName: "com.example.naming",
  name: "normalizeDeploymentName",
  script: "return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');",
  inputParameters: [{name: "name", type: "string", description: "Raw deployment name"}],
  returnType: "string"
)
  → Creates the action in the target module

User: Show me what was created.

Assistant calls: list-actions(filter: "normalizeDeploymentName")
Assistant calls: get-action(id: "<action-id>")
  → Returns the script, inputs, module, and return type for review
```

### Review and create blueprint templates

```
User: Show me the current Ubuntu template YAML, then create a starter template
      for a small web tier in project project-dev-123.

Assistant calls: list-templates(search: "Ubuntu")
  → Finds matching Cloud Assembly blueprint templates
Assistant calls: get-template(id: "<ubuntu-template-id>")
  → Returns status, project metadata, validity, and YAML content
Assistant calls: create-template(
  name: "Web Tier Starter",
  projectId: "project-dev-123",
  description: "Starter web tier blueprint for development",
  content: "formatVersion: 1\ninputs: {}\nresources: {}"
)
  → Creates a draft blueprint template that can be refined in Cloud Assembly
```

### Wire a vRO workflow to an event topic

```
User: Run the workflow "Post-Provision Hardening" whenever compute provisioning
      completes. Make it blocking if the event topic supports blocking.

Assistant calls: list-event-topics()
  → Finds the provisioning topic and whether it is blockable
Assistant calls: list-workflows(filter: "Post-Provision Hardening")
  → Finds the vRO workflow ID
Assistant calls: create-subscription(
  name: "Post-Provision Hardening",
  eventTopicId: "<provisioning-topic-id>",
  runnableType: "extensibility.vro",
  runnableId: "<workflow-id>",
  blocking: true,
  priority: 10,
  description: "Run hardening workflow after VM provisioning"
)
  → Creates an enabled subscription

User: Disable that hook while I test a new version.

Assistant calls: list-subscriptions()
Assistant calls: update-subscription(id: "<subscription-id>", disabled: true)
  → Disables the subscription without deleting it
```

### Manage runtime configuration and resource files

```
User: Create a Netbox configuration element and upload a logo resource used by
      the provisioning workflows.

Assistant calls: list-categories(type: "ConfigurationElementCategory", filter: "Integrations")
  → Returns category ID
Assistant calls: create-configuration(
  categoryId: "<category-id>",
  name: "Netbox Settings",
  description: "Netbox API connection parameters",
  attributes: [
    {name: "netboxUrl", type: "string", value: "https://netbox.example.com"},
    {name: "apiToken", type: "string", value: "your-token-here"}
  ]
)
  → Creates a typed configuration element

Assistant calls: list-categories(type: "ResourceElementCategory", filter: "Assets")
Assistant calls: import-resource-element(
  categoryId: "<resource-category-id>",
  fileName: "portal-logo.png",
  confirm: true
)
  → Imports a local file from the configured resource artifact directory

User: Rotate the Netbox token and replace the logo without changing workflow code.

Assistant calls: list-configurations(filter: "Netbox Settings")
Assistant calls: update-configuration(
  id: "<config-id>",
  attributes: [
    {name: "netboxUrl", type: "string", value: "https://netbox.example.com"},
    {name: "apiToken", type: "string", value: "new-token"}
  ]
)
Assistant calls: update-resource-element(
  id: "<resource-id>",
  fileName: "portal-logo-v2.png",
  confirm: true
)
  → Updates shared runtime data safely from local artifact directories
```

### Inspect platform capabilities before writing code

```
User: Before I write a workflow that talks to NSX and vCenter, show me the
      installed plugins and any actions that already do VM lookup.

Assistant calls: list-plugins()
Assistant calls: list-plugins(filter: "nsx")
Assistant calls: list-actions(filter: "getAllMachines")
Assistant calls: get-action(id: "<candidate-action-id>")
  → Shows installed plugin coverage and reusable library action code before
    generating or importing new workflow artifacts
```

## Development

```bash
# Type-check without emitting
npx tsc --noEmit

# Run in dev mode (no build step)
VCFA_HOST=... VCFA_USERNAME=... VCFA_ORGANIZATION=... VCFA_PASSWORD=... npm start

# Build for production
npm run build

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js
```
