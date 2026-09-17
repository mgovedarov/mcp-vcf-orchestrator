# Catalog And Deployment How-Tos

## Deploy From A Catalog Item

Use catalog discovery before submitting a deployment request.

```text
User: Find the Ubuntu catalog item and deploy a medium build agent.
```

Recommended sequence:

1. `list-catalog-items(search: "Ubuntu")`
2. `get-catalog-item(id: "...")`
3. `list-projects(search: "...")` to resolve the target `projectId`; never guess it
4. `create-deployment(catalogItemId: "...", deploymentName: "...", projectId: "...", inputs: {...}, expectedCatalogItemName: "...", expectedProjectName: "...", confirm: true)` — steps 1-3 exist to produce those two expected names; they are verified against live metadata before the request is submitted, so a transposed ID refuses instead of provisioning the wrong thing
5. `list-deployments(search: "...", projectId: "...")`

## Inspect A Deployment

`get-deployment` is the read to reach for when the question is about one existing deployment rather than the catalog: what it is, what state it is in, and **what it was given**.

```text
User: Why does alpine1 have a storage class and alpine2 doesn't? They're the same item.
```

1. `list-deployments(projectId: "...")` to find the ID.
2. `get-deployment(id: "<deployment-id>")`.

The `Inputs` block answers the reproduce/compare/troubleshoot question directly. Two deployments of one catalog item can carry different input sets when they were requested against different released blueprint versions, and the rendered `Catalog Item Version`, `Blueprint ID` and `Blueprint Version` are what identify that drift. The values are JSON, so they can be replayed into `create-deployment`'s `inputs` for a like-for-like redeploy.

Two things to hold onto when reading the block:

- A value rendered `[redacted]` was withheld because its **name** reads as credential material. It must be supplied fresh when replaying the inputs — copying the marker through would store the literal string.
- The reverse does not hold. The redaction is name-based, because a deployment record carries no marker saying which of its inputs were encrypted, so a secret under an unrecognized name **is** printed. Treat a deployment's inputs as potentially sensitive output: do not paste them into an issue, a commit message, or a chat log without reading them first.

## Discover And Run Day-2 Actions

After a deployment exists, inspect available actions before submitting one:

1. `list-deployment-actions(deploymentId: "<deployment-id>")`
2. Review action IDs, names, and input hints.
3. `run-deployment-action(..., confirm: true)`
4. Capture the request ID the tool renders.
5. Poll `get-deployment-request(requestId: "<request-id>")` until it reports a confirmed terminal or held status. Observed active statuses are `PENDING`, `INITIALIZATION`, `CHECKING_APPROVAL`, `INPROGRESS`, and `COMPLETION`; treat an unfamiliar status as potentially active. Task progress is not monotonic — the service replaces a placeholder total once it enumerates the tasks, so `0/1` can become `1/5`.

The action runs asynchronously. For anything but `Deployment.Delete`, the deployment's own status does not track it — `get-deployment` kept reading `CREATE_SUCCESSFUL` throughout a power action on vRA 8.18 — so the request read is the progress signal. After it succeeds, confirm the outcome on the deployment's resources. Day-2 action availability is deployment-specific. Do not guess action IDs or inputs from another deployment.

## Delete Deployments

`delete-deployment` is destructive. Use `get-deployment` first to confirm the ID, name, project, and status, then require explicit user confirmation before deletion.

The delete is asynchronous. The tool reports the deletion as *requested*, with the `Deployment.Delete` request the service queued, and the deployment reads `DELETE_INPROGRESS` until it is gone — close to a minute on the vRA 8.18 lab. Poll `get-deployment-request` with the returned request ID for operation progress. Even after that request succeeds, confirm resource removal by polling `get-deployment` until it answers `404`, or `list-deployments` until the deployment is absent; do not report the deployment gone on the strength of the request status alone.
