import assert from "node:assert/strict";
import test from "node:test";
import { registerDeploymentTools } from "../dist/tools/deployment-tools.js";

function registeredDeploymentTools(client) {
  const handlers = new Map();
  const server = {
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
  };
  registerDeploymentTools(server, client);
  return handlers;
}

test("list-deployment-actions reports empty action lists", async () => {
  const handlers = registeredDeploymentTools({
    listDeploymentActions: async () => ({ content: [], totalElements: 0 }),
  });

  const result = await handlers.get("list-deployment-actions")({
    deploymentId: "deployment-1",
  });

  assert.equal(
    result.content[0].text,
    "No deployment actions found for deployment deployment-1.",
  );
});

test("deployment tools list, get, create, and delete with confirmation", async () => {
  let createParams;
  let deletedId;
  const handlers = registeredDeploymentTools({
    listDeployments: async (search, projectId) => ({
      totalElements: 1,
      content: [
        {
          id: "deployment-1",
          name: `Ubuntu ${search}`,
          status: "CREATE_SUCCESSFUL",
          projectId,
        },
      ],
    }),
    getDeployment: async (id) => ({
      id,
      name: "Ubuntu VM",
      status: "CREATE_SUCCESSFUL",
      description: "Example deployment",
      projectName: "Development",
      catalogItemId: "catalog-1",
    }),
    createDeploymentFromCatalogItem: async (params) => {
      createParams = params;
      return { id: "request-1", name: params.deploymentName, status: "SUBMITTED" };
    },
    deleteDeployment: async (id) => {
      deletedId = id;
    },
  });

  const list = await handlers.get("list-deployments")({
    search: "22.04",
    projectId: "project-1",
  });
  assert.match(list.content[0].text, /Ubuntu 22\.04 \(id: deployment-1\)/);
  assert.match(list.content[0].text, /projectId: project-1/);

  const detail = await handlers.get("get-deployment")({ id: "deployment-1" });
  assert.match(detail.content[0].text, /Deployment: Ubuntu VM/);
  assert.match(detail.content[0].text, /Catalog Item ID: catalog-1/);

  const created = await handlers.get("create-deployment")({
    catalogItemId: "catalog-1",
    deploymentName: "Ubuntu VM",
    projectId: "project-1",
    version: "1.0.0",
    reason: "Test deployment",
    inputs: { size: "small" },
    confirm: true,
  });
  assert.deepEqual(createParams, {
    catalogItemId: "catalog-1",
    deploymentName: "Ubuntu VM",
    projectId: "project-1",
    version: "1.0.0",
    reason: "Test deployment",
    inputs: { size: "small" },
  });
  assert.match(created.content[0].text, /ID: request-1/);

  const refused = await handlers.get("delete-deployment")({
    id: "deployment-1",
    confirm: false,
  });
  assert.equal(deletedId, undefined);
  assert.match(refused.content[0].text, /setting confirm to true/);

  await handlers.get("delete-deployment")({
    id: "deployment-1",
    confirm: true,
  });
  assert.equal(deletedId, "deployment-1");
});

test("list-deployment-actions formats actions and input hints", async () => {
  const handlers = registeredDeploymentTools({
    listDeploymentActions: async () => ({
      content: [
        {
          id: "Deployment.Resize",
          name: "Resize",
          description: "Change deployment size",
          inputParameters: [
            {
              name: "size",
              type: "string",
              required: true,
              description: "Target size",
            },
          ],
        },
      ],
      totalElements: 1,
    }),
  });

  const result = await handlers.get("list-deployment-actions")({
    deploymentId: "deployment-1",
  });

  assert.match(result.content[0].text, /Found 1 deployment action/);
  assert.match(result.content[0].text, /Resize \(id: Deployment\.Resize\)/);
  assert.match(result.content[0].text, /inputs: size \(string\) required/);
});

test("list-deployment-actions accepts bare array API responses", async () => {
  const handlers = registeredDeploymentTools({
    listDeploymentActions: async () => [
      {
        id: "Deployment.ChangeLease",
        name: "ChangeLease",
        displayName: "Change Lease",
        description: "Set a deployment's expiration date",
      },
    ],
  });

  const result = await handlers.get("list-deployment-actions")({
    deploymentId: "deployment-1",
  });

  assert.match(result.content[0].text, /Found 1 deployment action/);
  assert.match(
    result.content[0].text,
    /ChangeLease \(id: Deployment\.ChangeLease\)/,
  );
});

test("run-deployment-action refuses to submit unless confirmed", async () => {
  let calls = 0;
  const handlers = registeredDeploymentTools({
    runDeploymentAction: async () => {
      calls += 1;
      return { id: "request-1" };
    },
  });

  const result = await handlers.get("run-deployment-action")({
    deploymentId: "deployment-1",
    actionId: "Deployment.Delete",
    confirm: false,
  });

  assert.equal(calls, 0);
  assert.match(result.content[0].text, /setting confirm to true/);
});

test("run-deployment-action reports submitted request id and status", async () => {
  const handlers = registeredDeploymentTools({
    runDeploymentAction: async (params) => ({
      id: "request-1",
      deploymentId: params.deploymentId,
      actionId: params.actionId,
      name: "Power off",
      status: "INPROGRESS",
    }),
  });

  const result = await handlers.get("run-deployment-action")({
    deploymentId: "deployment-1",
    actionId: "Deployment.PowerOff",
    reason: "Maintenance",
    inputs: { force: true },
    confirm: true,
  });

  assert.match(result.content[0].text, /ID: request-1/);
  assert.match(result.content[0].text, /Status: INPROGRESS/);
});

test("deployment delete expected guards stop mismatched deletion", async () => {
  let deletedId;
  const handlers = registeredDeploymentTools({
    getDeployment: async (id) => ({
      id,
      name: "Ubuntu VM",
      projectId: "project-1",
      status: "CREATE_SUCCESSFUL",
    }),
    deleteDeployment: async (id) => {
      deletedId = id;
    },
  });

  const result = await handlers.get("delete-deployment")({
    id: "deployment-1",
    expectedName: "Database VM",
    expectedProjectId: "project-1",
    confirm: true,
  });

  assert.equal(result.isError, true);
  assert.equal(deletedId, undefined);
  assert.match(result.content[0].text, /deployment name/);
});

test("run-deployment-action verifies expected deployment and action metadata", async () => {
  let requestParams;
  const handlers = registeredDeploymentTools({
    getDeployment: async (id) => ({
      id,
      name: "Ubuntu VM",
      projectId: "project-1",
      projectName: "Development",
      status: "CREATE_SUCCESSFUL",
    }),
    listDeploymentActions: async () => ({
      content: [{ id: "Deployment.PowerOff", name: "Power off" }],
    }),
    runDeploymentAction: async (params) => {
      requestParams = params;
      return { id: "request-1", status: "INPROGRESS" };
    },
  });

  const mismatch = await handlers.get("run-deployment-action")({
    deploymentId: "deployment-1",
    actionId: "Deployment.PowerOff",
    expectedDeploymentName: "Ubuntu VM",
    expectedActionName: "Delete",
    confirm: true,
  });
  assert.equal(mismatch.isError, true);
  assert.equal(requestParams, undefined);

  await handlers.get("run-deployment-action")({
    deploymentId: "deployment-1",
    actionId: "Deployment.PowerOff",
    expectedDeploymentName: "Ubuntu VM",
    expectedProjectName: "Development",
    expectedActionName: "Power off",
    confirm: true,
  });
  assert.deepEqual(requestParams, {
    deploymentId: "deployment-1",
    actionId: "Deployment.PowerOff",
    reason: undefined,
    inputs: undefined,
  });
});
