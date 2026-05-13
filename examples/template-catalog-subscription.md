# Template, Catalog, And Subscription Example

Use this flow when a workflow, blueprint template, catalog item, deployment, and extensibility subscription need to line up.

## Review Template And Catalog Shape

```text
Use prompt vcfa-integrate-workflow-template-subscription with:
integrationGoal: "Run a tagging workflow after Ubuntu catalog deployment creation."
workflowHint: "Tag VM"
templateHint: "Ubuntu"
```

```text
list-templates(search: "Ubuntu")
get-template(id: "<template-id>")
list-catalog-items(search: "Ubuntu")
get-catalog-item(id: "<catalog-item-id>")
list-deployments(search: "Ubuntu", projectId: "<project-id>")
```

## Validate Deployment Action Surface

```text
list-deployment-actions(deploymentId: "<deployment-id>")
run-deployment-action(deploymentId: "<deployment-id>", actionId: "<safe-action-id>", inputs: {}, reason: "Validated maintenance action", confirm: true)
```

## Plan Or Create Subscription

Discover the event topic and workflow contract first:

```text
list-event-topics()
list-workflows(filter: "Tag VM")
get-workflow(id: "<workflow-id>")
list-subscriptions(projectId: "<project-id>")
```

Create the subscription only after the topic, workflow ID, blocking behavior, and timeout are confirmed:

```text
create-subscription(name: "Tag Ubuntu deployments", eventTopicId: "<event-topic-id>", runnableType: "extensibility.vro", runnableId: "<workflow-id>", projectId: "<project-id>", blocking: false, priority: 100, timeout: 10, disabled: true, confirm: true)
get-subscription(id: "<subscription-id>")
```
