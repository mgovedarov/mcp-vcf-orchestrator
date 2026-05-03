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

Use prompts when you want the client assistant to follow one of the server's discovery-first playbooks. Prompts are most useful at the start of a task, before tool calls or artifact edits, because they tell the assistant which read-only discovery calls, resources, preflight checks, confirmation points, and verification steps belong in the workflow.

Use `vcfa-discover-capabilities` for exploratory conversational discovery. Use `vcfa-collect-context-snapshot` when that discovery should be persisted as reusable Markdown and JSON inventory for future agents.

### `vcfa-author-workflow`

Guide workflow authoring, scaffolding, preflight, and import. This prompt plans, scaffolds, preflights, and safely imports a vRO workflow artifact.

::: details Parameters
| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `goal` | string | Yes | - | Workflow goal or requirements. |
| `categoryHint` | string | No | - | Optional workflow category name or path hint. |
:::

### `vcfa-review-artifact-import`

Review a local workflow, action, configuration, or package artifact before import.

::: details Parameters
| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `artifactKind` | enum | Yes | - | Artifact kind to review: `workflow`, `action`, `configuration`, or `package`. |
| `fileName` | string | Yes | - | Local artifact file name to review. |
:::

### `vcfa-troubleshoot-deployment`

Inspect a deployment and guide safe troubleshooting or remediation.

::: details Parameters
| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `deploymentId` | string | Yes | - | Deployment ID to troubleshoot. |
:::

### `vcfa-discover-capabilities`

Discover reusable plugins, categories, actions, workflows, catalog items, and templates. Use this for exploratory conversational discovery before creating or importing anything.

::: details Parameters
| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `goal` | string | No | general discovery | Optional automation or troubleshooting goal to focus the discovery. |
:::

### `vcfa-collect-context-snapshot`

Persist reusable Markdown and JSON VCFA/vRO context for future agents.

::: details Parameters
| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `goal` | string | No | reusable VCFA/vRO context | Optional project or implementation goal for the snapshot. |
| `includeOptionalDomains` | boolean | No | `false` | Whether to include templates, catalog items, event topics, subscriptions, packages, and plugins in addition to the core context domains. |
:::

### `vcfa-build-workflow-from-action`

Discover an existing action and scaffold a workflow wrapper around its verified contract.

::: details Parameters
| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `actionHint` | string | Yes | - | Action name, module, ID, or fully qualified name hint. |
| `workflowGoal` | string | Yes | - | Desired workflow name or public behavior. |
| `categoryHint` | string | No | - | Optional workflow category name or path hint. |
:::

### `vcfa-refactor-workflow`

Inspect, export, preflight, and safely plan workflow refactors.

::: details Parameters
| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `workflowHint` | string | Yes | - | Workflow ID, name, or search hint for the workflow to refactor. |
| `refactorGoal` | string | Yes | - | Desired refactor outcome. |
:::

### `vcfa-create-template`

Discover existing Cloud Assembly templates and draft a new blueprint template safely.

::: details Parameters
| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `templateGoal` | string | Yes | - | Template purpose or desired workload. |
| `projectHint` | string | No | - | Optional project name or ID hint. |
:::

### `vcfa-review-template`

Inspect an existing blueprint template for correctness, reuse, and catalog readiness.

::: details Parameters
| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `templateId` | string | Yes | - | Template ID to review. |
| `reviewGoal` | string | No | - | Optional review focus, such as catalog readiness or small VM shape. |
:::

### `vcfa-integrate-workflow-template-subscription`

Plan integration between workflows, templates, catalog items, deployments, and extensibility subscriptions.

::: details Parameters
| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `integrationGoal` | string | Yes | - | Integration goal or lifecycle event. |
| `workflowHint` | string | No | - | Optional workflow name, ID, or search hint. |
| `templateHint` | string | No | - | Optional template name or ID hint. |
:::

### `vcfa-discovery-first-implementation-plan`

Produce a concrete implementation plan that starts with verified read-only VCFA/vRO discovery.

::: details Parameters
| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `goal` | string | Yes | - | Implementation goal. |
| `artifactKinds` | string | No | - | Optional artifact focus, such as `workflows`, `actions`, `templates`, or `subscriptions`. |
:::

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
