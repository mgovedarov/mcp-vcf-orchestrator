import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDeploymentInputs,
  registerDeploymentTools,
} from "../dist/tools/deployment-tools.js";

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

// --- VCFO-074: shapes observed live on VCF Automation 9.1 ---

test("create-deployment reports identifiers from the observed 9.1 request response", async () => {
  // The live route answers a BARE ARRAY of {deploymentId, deploymentName} and
  // carries no id/name/status, so reading the old `Deployment` fields printed
  // nothing identifying at all.
  const handlers = registeredDeploymentTools({
    createDeploymentFromCatalogItem: async () => [
      {
        deploymentId: "11111111-2222-4333-8444-555555555555",
        deploymentName: "vcfo074-livetest",
      },
    ],
  });

  const result = await handlers.get("create-deployment")({
    catalogItemId: "catalog-1",
    deploymentName: "vcfo074-livetest",
    projectId: "project-1",
    confirm: true,
  });

  assert.match(result.content[0].text, /Deployment request submitted\./);
  assert.match(result.content[0].text, /ID: 11111111-2222-4333-8444-555555555555/);
  assert.match(result.content[0].text, /Name: vcfo074-livetest/);
  assert.match(result.content[0].text, /poll get-deployment/);
});

test("create-deployment also reads a single request object and the id/name aliases", async () => {
  const handlers = registeredDeploymentTools({
    createDeploymentFromCatalogItem: async () => ({
      id: "deployment-9",
      name: "single-object-arm",
      status: "CREATE_INPROGRESS",
    }),
  });

  const result = await handlers.get("create-deployment")({
    catalogItemId: "catalog-1",
    deploymentName: "single-object-arm",
    projectId: "project-1",
    confirm: true,
  });

  assert.match(result.content[0].text, /ID: deployment-9/);
  assert.match(result.content[0].text, /Name: single-object-arm/);
  assert.match(result.content[0].text, /Status: CREATE_INPROGRESS/);
});

test("create-deployment says so when the response carries no identifier", async () => {
  const handlers = registeredDeploymentTools({
    createDeploymentFromCatalogItem: async () => [],
  });

  const result = await handlers.get("create-deployment")({
    catalogItemId: "catalog-1",
    deploymentName: "nameless",
    projectId: "project-7",
    confirm: true,
  });

  assert.match(result.content[0].text, /returned no deployment identifier/);
  assert.match(result.content[0].text, /projectId: project-7/);
  assert.doesNotMatch(result.content[0].text, /undefined/);
});

test("delete-deployment matches expectedProjectName when 9.1 serves no projectName", async () => {
  // Regression for the VCFO-077 class: a 9.1 deployment carries projectId but
  // no projectName, so comparing the expected value straight against the
  // deployment refused every legitimate call with `found (missing)`.
  let deletedId;
  const handlers = registeredDeploymentTools({
    getDeployment: async (id) => ({
      id,
      name: "vcfo074-livetest",
      status: "CREATE_SUCCESSFUL",
      projectId: "99999999-8888-4777-8666-555555555555",
    }),
    getProject: async (id) => ({ id, name: "default-project" }),
    deleteDeployment: async (id) => {
      deletedId = id;
    },
  });

  const result = await handlers.get("delete-deployment")({
    id: "deployment-1",
    confirm: true,
    expectedName: "vcfo074-livetest",
    expectedProjectName: "default-project",
  });

  assert.equal(result.isError, undefined);
  assert.equal(deletedId, "deployment-1");
});

test("delete-deployment still refuses a genuinely wrong expectedProjectName", async () => {
  let deleted = false;
  const handlers = registeredDeploymentTools({
    getDeployment: async (id) => ({ id, projectId: "project-1" }),
    getProject: async (id) => ({ id, name: "default-project" }),
    deleteDeployment: async () => {
      deleted = true;
    },
  });

  const result = await handlers.get("delete-deployment")({
    id: "deployment-1",
    confirm: true,
    expectedProjectName: "some-other-project",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /project name: expected "some-other-project", found "default-project"/);
  assert.equal(deleted, false);
});

test("delete-deployment reports an unverifiable project name rather than a mismatch", async () => {
  let deleted = false;
  const handlers = registeredDeploymentTools({
    getDeployment: async (id) => ({ id, projectId: "project-1" }),
    getProject: async (id) => ({ id }),
    deleteDeployment: async () => {
      deleted = true;
    },
  });

  const result = await handlers.get("delete-deployment")({
    id: "deployment-1",
    confirm: true,
    expectedProjectName: "default-project",
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Cannot verify expectedProjectName/);
  assert.match(result.content[0].text, /was not deleted/);
  assert.equal(deleted, false);
});

test("run-deployment-action resolves expectedProjectName through the project service", async () => {
  let submitted = false;
  const handlers = registeredDeploymentTools({
    getDeployment: async (id) => ({
      id,
      name: "vcfo074-livetest",
      status: "CREATE_SUCCESSFUL",
      projectId: "project-1",
    }),
    getProject: async (id) => ({ id, name: "default-project" }),
    listDeploymentActions: async () => [
      { id: "Deployment.PowerOff", name: "PowerOff", actionType: "RESOURCE_ACTION", valid: true },
    ],
    runDeploymentAction: async () => {
      submitted = true;
      return { id: "request-1" };
    },
  });

  const result = await handlers.get("run-deployment-action")({
    deploymentId: "deployment-1",
    actionId: "Deployment.PowerOff",
    confirm: true,
    expectedProjectName: "default-project",
    expectedActionName: "PowerOff",
  });

  assert.equal(result.isError, undefined);
  assert.equal(submitted, true);
});

test("list-deployment-actions handles the bare-array arm 9.1 actually serves", async () => {
  const handlers = registeredDeploymentTools({
    listDeploymentActions: async () => [
      { id: "Deployment.PowerOff", name: "PowerOff", description: "Power off a deployment", valid: true, actionType: "RESOURCE_ACTION" },
      { id: "Deployment.Delete", name: "Delete", description: "Delete a deployment", valid: true, actionType: "RESOURCE_ACTION" },
    ],
  });

  const result = await handlers.get("list-deployment-actions")({
    deploymentId: "deployment-1",
  });

  assert.match(result.content[0].text, /Found 2 deployment action\(s\)/);
  assert.match(result.content[0].text, /PowerOff \(id: Deployment\.PowerOff\)/);
});

// --- get-deployment: the inputs a deployment was requested with (VCFO-091) ---

function deploymentDetailTools(deployment, overrides = {}) {
  return registeredDeploymentTools({
    getDeployment: async (id) => ({ id, name: "alpine1", ...deployment }),
    ...overrides,
  });
}

test("get-deployment renders the inputs the deployment was requested with", async () => {
  const handlers = deploymentDetailTools({
    inputs: { hostname: "alpine1", vmClass: "small", storageClass: "gold" },
  });

  const result = await handlers.get("get-deployment")({ id: "deployment-1" });
  const text = result.content[0].text;

  assert.equal(result.isError, undefined);
  assert.match(text, /Inputs \(as requested\):/);
  assert.match(text, /• hostname: "alpine1"/);
  assert.match(text, /• vmClass: "small"/);
  assert.match(text, /• storageClass: "gold"/);
  // Nothing was withheld here, so the caller must not be told to resupply.
  assert.doesNotMatch(text, /supplied fresh/);
});

test("get-deployment never prints an input value whose name reads as a credential", async () => {
  const handlers = deploymentDetailTools({
    inputs: {
      hostname: "alpine1",
      adminPassword: "hunter2-should-never-render",
      apiToken: "token-should-never-render",
      sshPrivateKey: "key-should-never-render",
    },
  });

  const result = await handlers.get("get-deployment")({ id: "deployment-1" });
  const text = result.content[0].text;

  // The deployment record carries no encrypted marker, so the key's name is the
  // only signal there is. The input is still listed, so the caller knows it was
  // set and must supply it again to reproduce the deployment...
  assert.match(text, /• adminPassword: \[redacted\]/);
  assert.match(text, /• apiToken: \[redacted\]/);
  assert.match(text, /• sshPrivateKey: \[redacted\]/);
  assert.match(text, /\[redacted\] values must be supplied fresh/);
  // ...but the value itself is never printed.
  assert.doesNotMatch(text, /hunter2/);
  assert.doesNotMatch(text, /token-should-never-render/);
  assert.doesNotMatch(text, /key-should-never-render/);
  // The redaction is targeted, not blanket.
  assert.match(text, /• hostname: "alpine1"/);
});

test("get-deployment redacts a sensitive key nested inside an input value", async () => {
  const handlers = deploymentDetailTools({
    inputs: {
      sshConfig: { user: "root", privateKey: "nested-must-never-render" },
      disks: [{ size: 20, encryptionSecret: "array-must-never-render" }],
    },
  });

  const result = await handlers.get("get-deployment")({ id: "deployment-1" });
  const text = result.content[0].text;

  // A blueprint input can be an object or an array, so nesting must not be a
  // way around the guard -- a top-level-key check alone would print both of
  // these verbatim inside the JSON blob.
  assert.doesNotMatch(text, /nested-must-never-render/);
  assert.doesNotMatch(text, /array-must-never-render/);
  assert.match(text, /"privateKey":"\[redacted\]"/);
  assert.match(text, /"encryptionSecret":"\[redacted\]"/);
  // The rest of the structure survives.
  assert.match(text, /"user":"root"/);
  assert.match(text, /"size":20/);
  assert.match(text, /\[redacted\] values must be supplied fresh/);
});

test("get-deployment omits the inputs block when the platform serves none", async () => {
  for (const inputs of [undefined, {}]) {
    const handlers = deploymentDetailTools({ inputs });
    const result = await handlers.get("get-deployment")({ id: "deployment-1" });
    // A platform that does not serve the field must not look like one that
    // served an empty object.
    assert.doesNotMatch(result.content[0].text, /Inputs/);
    assert.equal(result.isError, undefined);
  }
});

test("formatDeploymentInputs renders values as JSON so they can be replayed", () => {
  assert.equal(formatDeploymentInputs(undefined), "");
  assert.equal(formatDeploymentInputs({}), "");

  const text = formatDeploymentInputs({
    count: 2,
    enabled: true,
    tags: ["a", "b"],
    placement: { zone: "az1" },
    notes: "",
    missing: undefined,
  });

  // JSON, unlike the configuration-attribute rendering, is exactly what
  // create-deployment's inputs object takes, so these round-trip.
  assert.match(text, /• count: 2/);
  assert.match(text, /• enabled: true/);
  assert.match(text, /• tags: \["a","b"\]/);
  assert.match(text, /• placement: \{"zone":"az1"\}/);
  // An empty string reads as "" rather than as blank space.
  assert.match(text, /• notes: ""/);
  // JSON.stringify(undefined) is undefined, not a string; never print the word.
  assert.match(text, /• missing: \(no value\)/);
  assert.doesNotMatch(text, /undefined/);
});

test("get-deployment resolves the project name the wire does not serve", async () => {
  let asked;
  const handlers = deploymentDetailTools(
    { projectId: "project-1" },
    { getProject: async (id) => ((asked = id), { id, name: "amer-wld" }) },
  );

  const result = await handlers.get("get-deployment")({ id: "deployment-1" });
  const text = result.content[0].text;

  // VCF Automation 9.1 carries projectId but no projectName, so without this
  // every real deployment rendered an opaque ID (VCFO-091).
  assert.equal(asked, "project-1");
  assert.match(text, /Project: amer-wld/);
  // The ID is what the other deployment tools take as an argument, so both print.
  assert.match(text, /Project ID: project-1/);
});

test("get-deployment still describes the deployment when the project read fails", async () => {
  const handlers = deploymentDetailTools(
    { projectId: "project-1", status: "CREATE_SUCCESSFUL" },
    {
      getProject: async () => {
        throw new Error("403 Forbidden");
      },
    },
  );

  const result = await handlers.get("get-deployment")({ id: "deployment-1" });
  const text = result.content[0].text;

  // The project name is an enrichment; losing it must not lose the deployment.
  assert.equal(result.isError, undefined);
  assert.match(text, /Status: CREATE_SUCCESSFUL/);
  assert.match(text, /Project ID: project-1/);
  assert.doesNotMatch(text, /Project: /);
  assert.doesNotMatch(text, /undefined/);
});

test("get-deployment renders the blueprint behind the requested catalog item version", async () => {
  const handlers = deploymentDetailTools({
    catalogItemVersion: "2",
    blueprintId: "blueprint-1",
    blueprintVersion: "2",
  });

  const result = await handlers.get("get-deployment")({ id: "deployment-1" });
  const text = result.content[0].text;

  // Version drift is what makes two deployments of one item carry different
  // input sets, so the blueprint behind the request is worth naming.
  assert.match(text, /Catalog Item Version: 2/);
  assert.match(text, /Blueprint ID: blueprint-1/);
  assert.match(text, /Blueprint Version: 2/);
});

test("delete-deployment reports the queued request instead of a finished deletion", async () => {
  // DELETE /deployments/{id} answers 200 with the Deployment.Delete request it
  // queued, and the deployment reads DELETE_INPROGRESS for a while before it
  // answers 404 (VCFO-088). "deleted successfully" overstated that.
  const handlers = registeredDeploymentTools({
    deleteDeployment: async () => ({
      id: "request-9",
      actionId: "Deployment.Delete",
      status: "PENDING",
    }),
  });

  const result = await handlers.get("delete-deployment")({
    id: "deployment-1",
    confirm: true,
  });

  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /Deletion of deployment deployment-1 requested\./);
  assert.match(result.content[0].text, /The service queued this request:\nID: request-9\n/);
  assert.match(result.content[0].text, /Action ID: Deployment\.Delete/);
  assert.match(result.content[0].text, /Status: PENDING/);
  assert.match(result.content[0].text, /poll get-deployment until it answers 404/);
  assert.doesNotMatch(result.content[0].text, /deleted successfully/);
});

test("delete-deployment still reads as requested when the service answers no body", async () => {
  const handlers = registeredDeploymentTools({
    deleteDeployment: async () => undefined,
  });

  const result = await handlers.get("delete-deployment")({
    id: "deployment-1",
    confirm: true,
  });

  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /Deletion of deployment deployment-1 requested\./);
  assert.match(result.content[0].text, /poll get-deployment until it answers 404/);
  assert.doesNotMatch(result.content[0].text, /queued this request/);
  assert.doesNotMatch(result.content[0].text, /undefined/);
});

test("run-deployment-action chooses its next step from the action, not a fixed sentence", async () => {
  // A Deployment.Delete request IS tracked by the deployment's own status
  // (DELETE_INPROGRESS, then 404); a power action is not (VCFO-088). One
  // hardcoded trailer was wrong for one of the two.
  const handlers = registeredDeploymentTools({
    runDeploymentAction: async ({ actionId }) => ({
      id: "request-4",
      actionId,
      status: "PENDING",
    }),
  });

  const power = await handlers.get("run-deployment-action")({
    deploymentId: "deployment-1",
    actionId: "Deployment.PowerOff",
    confirm: true,
  });
  assert.match(power.content[0].text, /get-deployment's status does not track it/);
  assert.doesNotMatch(power.content[0].text, /404/);

  const del = await handlers.get("run-deployment-action")({
    deploymentId: "deployment-1",
    actionId: "Deployment.Delete",
    confirm: true,
  });
  assert.match(del.content[0].text, /poll get-deployment until it answers 404/);
  assert.doesNotMatch(del.content[0].text, /does not track/);
});

test("deployment writes do not tell the caller to wait on a request that is not running", async () => {
  // An approval hold or a failure never reaches DELETE_INPROGRESS, so "poll
  // until 404" would be guidance that can never come true.
  const handlers = registeredDeploymentTools({
    runDeploymentAction: async () => ({
      id: "request-5",
      status: "APPROVAL_PENDING",
    }),
    deleteDeployment: async () => ({
      id: "request-6",
      actionId: "Deployment.Delete",
      status: "FAILED",
      details: "policy refused",
    }),
  });

  const action = await handlers.get("run-deployment-action")({
    deploymentId: "deployment-1",
    actionId: "Deployment.PowerOff",
    confirm: true,
  });
  assert.match(action.content[0].text, /APPROVAL_PENDING rather than a running state/);
  assert.doesNotMatch(action.content[0].text, /does not track|404/);

  const del = await handlers.get("delete-deployment")({
    id: "deployment-1",
    confirm: true,
  });
  assert.match(del.content[0].text, /FAILED rather than a running state/);
  assert.match(del.content[0].text, /Details: policy refused/);
  assert.doesNotMatch(del.content[0].text, /poll get-deployment until it answers 404/);
});
