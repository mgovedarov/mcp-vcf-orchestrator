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

test("list-deployments surfaces a pagination truncation warning", async () => {
  const handlers = registeredDeploymentTools({
    listDeployments: async () => ({
      totalElements: 50,
      truncated: true,
      content: [
        { id: "deployment-1", name: "VM 1", status: "CREATE_SUCCESSFUL" },
      ],
    }),
  });

  const result = await handlers.get("list-deployments")({});

  assert.match(result.content[0].text, /Results truncated/);
  assert.match(result.content[0].text, /collecting 1 of ~50 item\(s\)/);
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

test("deployment tools render a nameless deployment without leaking undefined", async () => {
  // VCFO-074: no deployment has ever been observed on either verification lab,
  // so the item shape is assumed. Guard it the way VCFO-070 guarded subscriptions.
  const handlers = registeredDeploymentTools({
    listDeployments: async () => ({
      totalElements: 1,
      content: [{ id: "deployment-1", status: "CREATE_INPROGRESS" }],
    }),
    getDeployment: async (id) => ({ id, status: "CREATE_INPROGRESS" }),
  });

  const list = await handlers.get("list-deployments")({});
  assert.match(list.content[0].text, /• \(unnamed\) \(id: deployment-1\)/);
  assert.doesNotMatch(list.content[0].text, /undefined/);
  assert.ok(!list.isError);

  const detail = await handlers.get("get-deployment")({ id: "deployment-1" });
  assert.match(detail.content[0].text, /^Deployment: \(unnamed\)\nID: deployment-1\n/);
  assert.doesNotMatch(detail.content[0].text, /undefined/);
  assert.ok(!detail.isError);
});

// create-deployment provisions real infrastructure from two opaque UUIDs, so it
// carries the same expected-target guards as its delete and run siblings
// (VCFO-084). The reads that back them are made only when an expected value is
// supplied, and an absent live name refuses rather than passing silently --
// the VCFO-077 resolution, since both names are optional on the wire.

function createDeploymentClient(overrides = {}) {
  const calls = { catalogItem: 0, project: 0, created: 0 };
  const client = {
    getCatalogItem: async (id) => {
      calls.catalogItem += 1;
      return { id, name: "Ubuntu Server" };
    },
    getProject: async (id) => {
      calls.project += 1;
      return { id, name: "Development" };
    },
    createDeploymentFromCatalogItem: async (params) => {
      calls.created += 1;
      return { id: "deployment-1", name: params.deploymentName, status: "SUBMITTED" };
    },
    ...overrides,
  };
  return { client, calls };
}

const CREATE_ARGS = {
  catalogItemId: "catalog-1",
  deploymentName: "Ubuntu VM",
  projectId: "project-1",
  confirm: true,
};

test("create-deployment skips the verification reads when no expected field is passed", async () => {
  const { client, calls } = createDeploymentClient({
    getCatalogItem: async () => {
      throw new Error("getCatalogItem must not be called");
    },
    getProject: async () => {
      throw new Error("getProject must not be called");
    },
  });
  const handlers = registeredDeploymentTools(client);

  const created = await handlers.get("create-deployment")({ ...CREATE_ARGS });

  assert.ok(!created.isError);
  assert.equal(calls.created, 1);
  assert.match(created.content[0].text, /ID: deployment-1/);
});

test("create-deployment reads only what the supplied expected fields need", async () => {
  const { client, calls } = createDeploymentClient();
  const handlers = registeredDeploymentTools(client);

  await handlers.get("create-deployment")({
    ...CREATE_ARGS,
    expectedCatalogItemName: "Ubuntu Server",
  });
  assert.deepEqual(calls, { catalogItem: 1, project: 0, created: 1 });

  const { client: second, calls: secondCalls } = createDeploymentClient();
  const secondHandlers = registeredDeploymentTools(second);
  await secondHandlers.get("create-deployment")({
    ...CREATE_ARGS,
    expectedProjectName: "Development",
  });
  assert.deepEqual(secondCalls, { catalogItem: 0, project: 1, created: 1 });
});

test("create-deployment refuses a catalog item name mismatch before provisioning", async () => {
  const { client, calls } = createDeploymentClient();
  const handlers = registeredDeploymentTools(client);

  const result = await handlers.get("create-deployment")({
    ...CREATE_ARGS,
    expectedCatalogItemName: "Windows Server",
  });

  assert.equal(result.isError, true);
  assert.equal(calls.created, 0);
  assert.match(result.content[0].text, /catalog item name: expected/);
  assert.match(result.content[0].text, /No live mutation was performed/);
});

test("create-deployment refuses a project mismatch before provisioning", async () => {
  const { client, calls } = createDeploymentClient();
  const handlers = registeredDeploymentTools(client);

  const byName = await handlers.get("create-deployment")({
    ...CREATE_ARGS,
    expectedProjectName: "Production",
  });
  assert.equal(byName.isError, true);
  assert.equal(calls.created, 0);
  assert.match(byName.content[0].text, /project name: expected/);
  assert.match(byName.content[0].text, /No live mutation was performed/);
});

test("create-deployment checks the catalog item before the project", async () => {
  const { client, calls } = createDeploymentClient();
  const handlers = registeredDeploymentTools(client);

  const result = await handlers.get("create-deployment")({
    ...CREATE_ARGS,
    expectedCatalogItemName: "Windows Server",
    expectedProjectName: "Production",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /catalog item name: expected/);
  assert.doesNotMatch(result.content[0].text, /project name: expected/);
  // A blueprint mismatch is the more urgent signal, so the project read never
  // happens and cannot mask it.
  assert.equal(calls.project, 0);
});

test("create-deployment refuses when a live name cannot confirm the expected value", async () => {
  const { client, calls } = createDeploymentClient({
    getCatalogItem: async (id) => ({ id }),
  });
  const handlers = registeredDeploymentTools(client);

  const result = await handlers.get("create-deployment")({
    ...CREATE_ARGS,
    expectedCatalogItemName: "Ubuntu Server",
  });

  assert.equal(result.isError, true);
  assert.equal(calls.created, 0);
  assert.match(result.content[0].text, /Cannot verify expectedCatalogItemName/);
  assert.match(result.content[0].text, /No deployment was requested/);
  assert.doesNotMatch(result.content[0].text, /undefined/);

  const { client: nameless, calls: namelessCalls } = createDeploymentClient({
    getProject: async (id) => ({ id }),
  });
  const namelessHandlers = registeredDeploymentTools(nameless);
  const project = await namelessHandlers.get("create-deployment")({
    ...CREATE_ARGS,
    expectedProjectName: "Development",
  });
  assert.equal(project.isError, true);
  assert.equal(namelessCalls.created, 0);
  assert.match(project.content[0].text, /Cannot verify expectedProjectName/);
});

test("create-deployment passes matching expected fields through to the request", async () => {
  let createParams;
  const { client, calls } = createDeploymentClient({
    createDeploymentFromCatalogItem: async (params) => {
      createParams = params;
      return { id: "deployment-1", status: "SUBMITTED" };
    },
  });
  const handlers = registeredDeploymentTools(client);

  const result = await handlers.get("create-deployment")({
    ...CREATE_ARGS,
    expectedCatalogItemName: "Ubuntu Server",
    expectedProjectName: "Development",
  });

  assert.ok(!result.isError);
  assert.equal(calls.catalogItem, 1);
  assert.equal(calls.project, 1);
  // The expected* arguments are guards, not request fields.
  assert.deepEqual(createParams, {
    catalogItemId: "catalog-1",
    deploymentName: "Ubuntu VM",
    projectId: "project-1",
    version: undefined,
    reason: undefined,
    inputs: undefined,
  });
});

test("create-deployment states the provisioning impact before it is confirmed", async () => {
  const { client, calls } = createDeploymentClient();
  const handlers = registeredDeploymentTools(client);

  const unguarded = await handlers.get("create-deployment")({
    ...CREATE_ARGS,
    confirm: false,
  });
  assert.equal(calls.created, 0);
  assert.equal(calls.catalogItem, 0);
  assert.match(unguarded.content[0].text, /provisions real infrastructure/);
  assert.match(unguarded.content[0].text, /will not be verified against live metadata/);

  const guarded = await handlers.get("create-deployment")({
    ...CREATE_ARGS,
    expectedCatalogItemName: "Ubuntu Server",
    confirm: false,
  });
  assert.equal(calls.created, 0);
  assert.match(guarded.content[0].text, /will be verified against live metadata/);
});

test("create-deployment reports a failed verification read without provisioning", async () => {
  const { client, calls } = createDeploymentClient({
    getCatalogItem: async () => {
      throw new Error("catalog service unavailable");
    },
  });
  const handlers = registeredDeploymentTools(client);

  const result = await handlers.get("create-deployment")({
    ...CREATE_ARGS,
    expectedCatalogItemName: "Ubuntu Server",
  });

  assert.equal(result.isError, true);
  assert.equal(calls.created, 0);
  // Named as a verification-read failure, not as "Failed to create deployment":
  // an operator must be able to tell that nothing was provisioned.
  assert.match(result.content[0].text, /Cannot verify expectedCatalogItemName/);
  assert.match(result.content[0].text, /catalog service unavailable/);
  assert.match(result.content[0].text, /No deployment was requested/);
  assert.doesNotMatch(result.content[0].text, /Failed to create deployment/);
});
