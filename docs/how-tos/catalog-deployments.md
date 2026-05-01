# Catalog And Deployment How-Tos

## Deploy From A Catalog Item

Use catalog discovery before submitting a deployment request.

```text
User: Find the Ubuntu catalog item and deploy a medium build agent.
```

Recommended sequence:

1. `list-catalog-items(search: "Ubuntu")`
2. `get-catalog-item(id: "...")`
3. `create-deployment(catalogItemId: "...", deploymentName: "...", projectId: "...", inputs: {...})`
4. `list-deployments(search: "...", projectId: "...")`

## Discover And Run Day-2 Actions

After a deployment exists, inspect available actions before submitting one:

1. `list-deployment-actions(deploymentId: "<deployment-id>")`
2. Review action IDs, names, and input hints.
3. `run-deployment-action(..., confirm: true)`

Day-2 action availability is deployment-specific. Do not guess action IDs or inputs from another deployment.

## Delete Deployments

`delete-deployment` is destructive. Use `get-deployment` first to confirm the ID, name, project, and status, then require explicit user confirmation before deletion.
