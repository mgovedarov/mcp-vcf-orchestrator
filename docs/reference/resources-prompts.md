# Resources And Prompts

The server exposes MCP resources for documentation, artifact patterns, and live object lookup. It also provides prompts that guide agents through discovery-first workflows.

## Resources

| Resource URI | Purpose |
| --- | --- |
| `vcfa://docs/readme` | README content for tool usage and configuration. |
| `vcfa://docs/artifact-authoring` | vRO artifact authoring and import/export guide. |
| `vcfa://schemas/workflow-scaffold` | Structured contract and validation notes for `scaffold-workflow-file`. |
| `vcfa://patterns/workflows/basic-scriptable-task` | Guidance for linear scriptable-task workflows. |
| `vcfa://patterns/workflows/action-wrapper` | Guidance for wrapping a verified vRO action in a workflow. |
| `vcfa://patterns/templates/conventions` | Blueprint template metadata/content conventions and authoring rules. |
| `vcfa://patterns/templates/small-vm` | Guidance for minimal small VM blueprint templates. |
| `vcfa://patterns/templates/catalog-ready` | Guidance for catalog-facing templates and deployment workflow alignment. |
| `vcfa://workflows/{id}` | Workflow metadata as JSON. |
| `vcfa://actions/{id}` | Action metadata and script details as JSON. |
| `vcfa://deployments/{id}` | Deployment details as JSON. |
| `vcfa://packages/{name}` | vRO package metadata as JSON. |

## Prompts

| Prompt | Purpose |
| --- | --- |
| `vcfa-author-workflow` | Guide workflow authoring, scaffolding, preflight, and import. |
| `vcfa-review-artifact-import` | Review local artifacts before import. |
| `vcfa-troubleshoot-deployment` | Inspect a deployment and guide safe remediation. |
| `vcfa-discover-capabilities` | Discover reusable plugins, categories, actions, workflows, catalog items, and templates. |
| `vcfa-collect-context-snapshot` | Persist reusable Markdown/JSON VCFA/vRO context for future agents. |
| `vcfa-build-workflow-from-action` | Discover an existing action and scaffold a verified workflow wrapper. |
| `vcfa-refactor-workflow` | Inspect, export, preflight, and safely plan workflow refactors. |
| `vcfa-create-template` | Discover templates and create blueprint templates safely. |
| `vcfa-review-template` | Review template metadata, content, and catalog readiness. |
| `vcfa-integrate-workflow-template-subscription` | Plan workflow, template, catalog, deployment, and subscription integration. |
| `vcfa-discovery-first-implementation-plan` | Produce a phased plan that starts with verified read-only discovery. |

Use prompts when you want the client assistant to follow one of the server's discovery-first playbooks. Prompts are most useful at the start of a task, before tool calls or artifact edits, because they tell the assistant which read-only discovery calls, resources, preflight checks, confirmation points, and verification steps belong in the workflow.

Use `vcfa-discover-capabilities` for exploratory conversational discovery. Use `vcfa-collect-context-snapshot` when that discovery should be persisted as reusable Markdown and JSON inventory for future agents.

## Prompt Parameters

### vcfa-author-workflow

| Parameter | Required | Description |
| --- | --- | --- |
| `goal` | yes | Workflow goal or requirements. |
| `categoryHint` | no | Workflow category name or path hint. |

### vcfa-review-artifact-import

| Parameter | Required | Description |
| --- | --- | --- |
| `artifactKind` | yes | Artifact kind: `workflow`, `action`, `configuration`, or `package`. |
| `fileName` | yes | Local artifact file name to review. |

### vcfa-troubleshoot-deployment

| Parameter | Required | Description |
| --- | --- | --- |
| `deploymentId` | yes | Deployment ID to inspect and troubleshoot. |

### vcfa-discover-capabilities

| Parameter | Required | Description |
| --- | --- | --- |
| `goal` | no | Optional automation or troubleshooting goal to focus the discovery. |

### vcfa-collect-context-snapshot

| Parameter | Required | Description |
| --- | --- | --- |
| `goal` | no | Optional project or implementation goal for the snapshot. |
| `includeOptionalDomains` | no | Also collect templates, catalog items, event topics, subscriptions, packages, and plugins. |

### vcfa-build-workflow-from-action

| Parameter | Required | Description |
| --- | --- | --- |
| `actionHint` | yes | Action name, module, ID, or fully qualified name hint. |
| `workflowGoal` | yes | Desired workflow name or public behavior. |
| `categoryHint` | no | Workflow category name or path hint. |

### vcfa-refactor-workflow

| Parameter | Required | Description |
| --- | --- | --- |
| `workflowHint` | yes | Workflow ID, name, or search hint for the workflow to refactor. |
| `refactorGoal` | yes | Desired refactor outcome. |

### vcfa-create-template

| Parameter | Required | Description |
| --- | --- | --- |
| `templateGoal` | yes | Template purpose or desired workload. |
| `projectHint` | no | Project name or ID hint. |

### vcfa-review-template

| Parameter | Required | Description |
| --- | --- | --- |
| `templateId` | yes | Template ID to review. |
| `reviewGoal` | no | Optional review focus, such as catalog readiness or small VM shape. |

### vcfa-integrate-workflow-template-subscription

| Parameter | Required | Description |
| --- | --- | --- |
| `integrationGoal` | yes | Integration goal or lifecycle event to orchestrate. |
| `workflowHint` | no | Optional workflow name, ID, or search hint. |
| `templateHint` | no | Optional template name or ID hint. |

### vcfa-discovery-first-implementation-plan

| Parameter | Required | Description |
| --- | --- | --- |
| `goal` | yes | Implementation goal. |
| `artifactKinds` | no | Optional artifact focus, such as `workflows`, `actions`, `templates`, or `subscriptions`. |

## Prompt Examples

Initial environment discovery:

```text
Use prompt vcfa-discover-capabilities with:
goal: "Map reusable VM provisioning workflows, actions, templates, catalog items, and subscriptions."
```

Persist reusable context:

```text
Use prompt vcfa-collect-context-snapshot with:
goal: "Persist reusable VM provisioning context before implementation work."
includeOptionalDomains: true
```

For large environments where the default 100-item-per-domain limit causes skipped items, call the tool directly with a higher limit:

```text
Use collect-context-snapshot with:
fileBaseName: vcfa-context-full
includeOptionalDomains: true
maxItemsPerDomain: 600
overwrite: true
```

Discovery-first implementation planning:

```text
Use prompt vcfa-discovery-first-implementation-plan with:
goal: "Create a workflow that lists VMs by project name."
artifactKinds: "workflows and actions"
```

Author a new workflow:

```text
Use prompt vcfa-author-workflow with:
goal: "Build a workflow that accepts a project name and returns matching VM names."
categoryHint: "VCFA"
```

Wrap an existing action:

```text
Use prompt vcfa-build-workflow-from-action with:
actionHint: "getAllMachines"
workflowGoal: "Expose machine inventory lookup as a workflow."
categoryHint: "VCFA"
```

Review before import:

```text
Use prompt vcfa-review-artifact-import with:
artifactKind: "workflow"
fileName: "list-vms-by-project.workflow"
```

Template work:

```text
Use prompt vcfa-create-template with:
templateGoal: "Small Ubuntu VM blueprint aligned with existing catalog conventions."
projectHint: "Development"
```

Subscription or integration planning:

```text
Use prompt vcfa-integrate-workflow-template-subscription with:
integrationGoal: "Run a tagging workflow after deployment creation."
workflowHint: "Tag VM"
templateHint: "Ubuntu"
```

## Discovery Guardrail

Workflow and template implementation prompts tell agents to stop when required environment details are missing. Agents should report missing workflows, actions, categories, projects, parameters, return types, IDs, or blueprint schema details instead of inventing plausible values. When action discovery is required, `list-actions` must produce an exact candidate and `get-action` must verify the contract; no match, partial data, or ambiguous action data means the agent should stop and ask for the missing details instead of inventing parameter names or return types.
