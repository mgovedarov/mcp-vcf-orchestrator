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
