# MCP Server for VCF Automation Orchestrator

[![npm version](https://img.shields.io/npm/v/@mgovedarov/mcp-vcf-orchestrator)](https://www.npmjs.com/package/@mgovedarov/mcp-vcf-orchestrator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An [MCP](https://modelcontextprotocol.io/) server that exposes VCF Automation Orchestrator (vRO), Service Broker, and Cloud Assembly REST API operations as tools. Enables AI assistants to list, create, delete, and run workflows, actions, configuration elements, extensibility subscriptions, catalog items, deployments, blueprint templates, and plugins via natural language.

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

| Variable | Required | Description |
|----------|----------|-------------|
| `VCFA_HOST` | Yes | VCFA hostname (e.g. `vcfa.example.com`) |
| `VCFA_USERNAME` | Yes | Username without organization (e.g. `admin`) |
| `VCFA_ORGANIZATION` | Yes | Organization/tenant (e.g. `System` or `vsphere.local`) |
| `VCFA_PASSWORD` | Yes | Password |
| `VCFA_IGNORE_TLS` | No | Set to `true` to skip TLS certificate verification (lab environments) |

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

| Tool | Description |
|------|-------------|
| `list-workflows` | List workflows, optionally filtered by name |
| `get-workflow` | Get workflow details including input/output parameters |
| `create-workflow` | Create a new empty workflow in a category |
| `delete-workflow` | Delete a workflow (irreversible) |
| `run-workflow` | Execute a workflow with optional input parameters |
| `list-workflow-executions` | List past and current executions for a workflow, with optional status filter |
| `get-workflow-execution` | Check execution status and retrieve outputs |

### Actions

| Tool | Description |
|------|-------------|
| `list-actions` | List actions (scriptable tasks), optionally filtered by name |
| `get-action` | Get action details including script content and parameters |
| `create-action` | Create a new action with script content |
| `delete-action` | Delete an action (irreversible) |

### Configuration Elements

| Tool | Description |
|------|-------------|
| `list-configurations` | List configuration elements, optionally filtered by name |
| `get-configuration` | Get configuration element details and attributes |
| `create-configuration` | Create a new configuration element with attributes |
| `delete-configuration` | Delete a configuration element (irreversible) |

### Categories

| Tool | Description |
|------|-------------|
| `list-categories` | List categories by type (`WorkflowCategory`, `ActionCategory`, `ConfigurationElementCategory`) |

### Catalog Items

| Tool | Description |
|------|-------------|
| `list-catalog-items` | List available Service Broker catalog items, optionally searched by name |
| `get-catalog-item` | Get catalog item details including type, source, and project assignments |

### Deployments

| Tool | Description |
|------|-------------|
| `list-deployments` | List deployments, optionally filtered by name/keyword or project ID |
| `get-deployment` | Get deployment details including status, project, and catalog item info |
| `create-deployment` | Deploy a catalog item by providing its ID, a deployment name, and a project ID |
| `delete-deployment` | Delete a deployment (irreversible) |

### Blueprint Templates

| Tool | Description |
|------|-------------|
| `list-templates` | List blueprint templates, optionally filtered by name/keyword or project ID |
| `get-template` | Get template details including status, project, validity, and full YAML content |
| `create-template` | Create a new blueprint template with optional YAML content |
| `delete-template` | Delete a blueprint template (irreversible) |

### vRO Packages

| Tool | Description |
|------|-------------|
| `list-packages` | List vRO packages on the Orchestrator instance, optionally filtered by name |
| `get-package` | Get details of a specific package by its fully-qualified name |
| `export-package` | Export a package as a ZIP file to a local path |
| `import-package` | Import a package from a local ZIP file into the Orchestrator instance |
| `delete-package` | Delete a package, optionally deleting all its contained elements |

### vRO Plugins

| Tool | Description |
|------|-------------|
| `list-plugins` | List installed plugins on the Orchestrator instance, optionally filtered by name |

### Extensibility Subscriptions

| Tool | Description |
|------|-------------|
| `list-event-topics` | List available event topics from the Event Broker |
| `list-subscriptions` | List extensibility subscriptions, optionally filtered by project ID |
| `get-subscription` | Get subscription details including constraints, blocking, and priority |
| `create-subscription` | Create a new subscription linking an event topic to a vRO workflow or ABX action |
| `update-subscription` | Update a subscription (enable/disable, re-target, change priority) |
| `delete-subscription` | Delete a subscription |

## Examples

These examples show natural language prompts you can use with an AI assistant connected to this MCP server.

### Discover and run a workflow

```
User: Find workflows related to "snapshot" and show me their parameters.

Assistant calls: list-workflows(filter: "snapshot")
  → Returns matching workflows with IDs
Assistant calls: get-workflow(id: "...")
  → Returns input/output parameters

User: Run the "Create a snapshot" workflow on the VM named "web-server-01".

Assistant calls: run-workflow(id: "...", inputs: [{name: "vm", type: "VC:VirtualMachine", value: "..."}])
  → Returns execution ID
Assistant calls: get-workflow-execution(workflowId: "...", executionId: "...")
  → Returns state: "completed", outputs
```

### Create a custom action

```
User: Create an action in the com.example.util module that takes a VM name
      and returns its IP address.

Assistant calls: create-action(
  moduleName: "com.example.util",
  name: "getVmIpAddress",
  script: "var vm = VcPlugin.getAllVirtualMachines(null, 'xpath:name=\"' + vmName + '\"')[0]; return vm.guest.ipAddress;",
  inputParameters: [{name: "vmName", type: "string", description: "Name of the VM"}],
  returnType: "string"
)
  → Action created: getVmIpAddress (id: ...)
```

### Set up an extensibility subscription

```
User: I want to run a vRO workflow every time a VM is provisioned.
      Which event topics are available for compute provisioning?

Assistant calls: list-event-topics()
  → Shows topics including "compute.provision.post" (blockable)

User: Create a subscription that triggers workflow "Post-Provision Hardening"
      on the compute.provision.post event. Make it blocking with priority 10.

Assistant calls: list-workflows(filter: "Post-Provision Hardening")
  → Returns workflow ID
Assistant calls: create-subscription(
  name: "Post-Provision VM Hardening",
  eventTopicId: "compute.provision.post",
  runnableType: "extensibility.vro",
  runnableId: "<workflow-id>",
  blocking: true,
  priority: 10
)
  → Subscription created: Post-Provision VM Hardening (ENABLED)
```

### Browse and manage blueprint templates

```
User: List all blueprint templates in the system.

Assistant calls: list-templates()
  → Lists templates with IDs, status, and project names

User: Show me the YAML content of the "Ubuntu OS Provisioning" template.

Assistant calls: get-template(id: "...")
  → Returns full blueprint YAML content and metadata

User: Create a new blank blueprint template called "Web Tier" in the dev project.

Assistant calls: create-template(
  name: "Web Tier",
  projectId: "<dev-project-id>",
  description: "Blueprint for web tier VMs"
)
  → Template created: Web Tier (id: ...) [DRAFT]

User: Delete the "linux test" template.

Assistant calls: delete-template(id: "...", confirm: true)
  → Template deleted successfully.
```

### List and deploy a catalog item

```
User: What catalog items are available in the Service Broker?

Assistant calls: list-catalog-items()
  → Lists all catalog items with IDs and types

User: Deploy "Ubuntu 22.04 Server" to project "dev-team" and name it
      "build-agent-01".

Assistant calls: get-catalog-item(id: "...")
  → Shows inputs required: size, diskGb
Assistant calls: create-deployment(
  catalogItemId: "...",
  deploymentName: "build-agent-01",
  projectId: "<dev-team-project-id>",
  inputs: {size: "medium", diskGb: 80}
)
  → Deployment request submitted. ID: ... Status: CREATE_IN_PROGRESS

User: Check all deployments in the dev-team project.

Assistant calls: list-deployments(projectId: "<dev-team-project-id>")
  → Lists deployments with status
```

### Manage existing subscriptions

```
User: Show me all extensibility subscriptions and disable the one for
      network tagging.

Assistant calls: list-subscriptions()
  → Lists all subscriptions with status
Assistant calls: get-subscription(id: "...")
  → Shows full details for the network tagging subscription
Assistant calls: update-subscription(id: "...", disabled: true)
  → Subscription updated: DISABLED
```

### Inspect and manage configuration elements

```
User: Find configuration elements related to "SMTP" and show me their
      attributes.

Assistant calls: list-configurations(filter: "SMTP")
  → Returns matching config elements
Assistant calls: get-configuration(id: "...")
  → Shows attributes: smtpHost (string), smtpPort (number), useTls (boolean)

User: Create a new configuration element for Netbox integration settings
      under the Library category.

Assistant calls: list-categories(type: "ConfigurationElementCategory", filter: "Library")
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
  → Configuration element created: Netbox Settings (id: ...)
```

### End-to-end: build a provisioning hook

```
User: I need a complete compute provisioning hook that assigns a custom
      hostname. Create the action, then wire it up with a subscription
      on the compute.allocation.pre event.

Assistant calls: create-action(
  moduleName: "com.example.naming",
  name: "generateHostname",
  script: "var prefix = inputProperties.get('customProperties').get('prefix') || 'vm'; ...",
  inputParameters: [{name: "inputProperties", type: "Properties"}],
  returnType: "Properties"
)
  → Action created

Assistant calls: list-event-topics()
  → Confirms compute.allocation.pre is available and blockable

Assistant calls: create-subscription(
  name: "Custom Hostname Generator",
  eventTopicId: "compute.allocation.pre",
  runnableType: "extensibility.abx",
  runnableId: "<action-id>",
  blocking: true,
  priority: 5,
  description: "Assigns custom hostnames during VM provisioning"
)
  → Subscription created and ENABLED
```

### List installed plugins

```
User: What plugins are installed on the Orchestrator?

Assistant calls: list-plugins()
  → Found 12 plugin(s):
     • vCenter Plugin (com.vmware.library.vc) v8.0.0 — vCenter Server integration
     • SSH Plugin (com.vmware.library.ssh) v2.0.0 — SSH remote execution
     ...

User: Show me only plugins related to NSX.

Assistant calls: list-plugins(filter: "nsx")
  → Found 2 plugin(s):
     • NSX-T Plugin (com.vmware.library.nsx-t) v3.2.0
     • NSX ALB Plugin (com.vmware.library.nsxalb) v1.0.0
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