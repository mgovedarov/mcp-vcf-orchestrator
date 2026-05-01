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
| `vcfa-build-workflow-from-action` | Discover an existing action and scaffold a verified workflow wrapper. |
| `vcfa-refactor-workflow` | Inspect, export, preflight, and safely plan workflow refactors. |
| `vcfa-create-template` | Discover templates and create blueprint templates safely. |
| `vcfa-review-template` | Review template metadata, content, and catalog readiness. |
| `vcfa-integrate-workflow-template-subscription` | Plan workflow, template, catalog, deployment, and subscription integration. |
| `vcfa-discovery-first-implementation-plan` | Produce a phased plan that starts with verified read-only discovery. |

## Discovery Guardrail

Workflow and template implementation prompts tell agents to stop when required environment details are missing. Agents should report missing workflows, actions, categories, projects, parameters, return types, IDs, or blueprint schema details instead of inventing plausible values.
