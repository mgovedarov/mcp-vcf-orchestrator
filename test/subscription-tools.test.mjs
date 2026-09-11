import assert from "node:assert/strict";
import test from "node:test";
import { registerSubscriptionTools } from "../dist/tools/subscription-tools.js";

function registeredSubscriptionTools(client) {
  const handlers = new Map();
  const server = {
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
  };
  registerSubscriptionTools(server, client);
  return handlers;
}

test("subscription tools format topics, lists, and details", async () => {
  const handlers = registeredSubscriptionTools({
    listEventTopics: async () => ({
      content: [
        {
          id: "topic-1",
          name: "Deployment requested",
          blockable: true,
          description: "Runs before deployment",
        },
      ],
    }),
    listSubscriptions: async (projectId) => ({
      content: [
        {
          id: "sub-1",
          name: `Approval ${projectId}`,
          eventTopicId: "topic-1",
          runnableType: "extensibility.vro",
          runnableId: "workflow-1",
          disabled: false,
        },
      ],
    }),
    getSubscription: async (id) => ({
      id,
      name: "Approval",
      description: "Gate deployments",
      disabled: true,
      eventTopicId: "topic-1",
      runnableType: "extensibility.vro",
      runnableId: "workflow-1",
      blocking: true,
      priority: 10,
      timeout: 30,
      constraints: { projectId: "project-1" },
    }),
  });

  const topics = await handlers.get("list-event-topics")({});
  assert.match(
    topics.content[0].text,
    /Deployment requested \(id: topic-1\) \[blockable\]/,
  );

  const subscriptions = await handlers.get("list-subscriptions")({
    projectId: "project-1",
  });
  assert.match(
    subscriptions.content[0].text,
    /Approval project-1 \(id: sub-1\)/,
  );
  assert.match(subscriptions.content[0].text, /ENABLED/);

  const detail = await handlers.get("get-subscription")({ id: "sub-1" });
  assert.match(detail.content[0].text, /Status: DISABLED/);
  assert.match(detail.content[0].text, /Blocking: true/);
  assert.match(detail.content[0].text, /Constraints: omitted/);
  assert.match(detail.content[0].text, /sha256: [0-9a-f]{64}/);
  assert.match(detail.content[0].text, /includeConstraints: true/);
  assert.ok(!detail.content[0].text.includes('"projectId": "project-1"'));

  const fullDetail = await handlers.get("get-subscription")({
    id: "sub-1",
    includeConstraints: true,
  });
  assert.match(fullDetail.content[0].text, /"projectId": "project-1"/);
});

test("subscription tools pass create and update payloads through", async () => {
  let createdParams;
  let updatedCall;
  const handlers = registeredSubscriptionTools({
    createSubscription: async (params) => {
      createdParams = params;
      return { id: "sub-1", name: params.name, disabled: params.disabled };
    },
    updateSubscription: async (id, params) => {
      updatedCall = { id, params };
      return { id, name: params.name, disabled: params.disabled };
    },
  });

  const created = await handlers.get("create-subscription")({
    name: "Provisioning approval",
    eventTopicId: "topic-1",
    runnableType: "extensibility.vro",
    runnableId: "workflow-1",
    projectId: "project-1",
    description: "Gate deployment requests",
    blocking: true,
    priority: 10,
    timeout: 30,
    disabled: true,
    confirm: true,
  });
  assert.deepEqual(createdParams, {
    name: "Provisioning approval",
    eventTopicId: "topic-1",
    runnableType: "extensibility.vro",
    runnableId: "workflow-1",
    projectId: "project-1",
    description: "Gate deployment requests",
    blocking: true,
    priority: 10,
    timeout: 30,
    disabled: true,
  });
  assert.match(created.content[0].text, /Status: DISABLED/);

  await handlers.get("update-subscription")({
    id: "sub-1",
    name: "Provisioning approval v2",
    disabled: false,
    runnableId: "workflow-2",
    runnableType: "extensibility.vro",
    blocking: false,
    priority: 20,
    timeout: 45,
    confirm: true,
  });
  assert.deepEqual(updatedCall, {
    id: "sub-1",
    params: {
      name: "Provisioning approval v2",
      description: undefined,
      disabled: false,
      runnableId: "workflow-2",
      runnableType: "extensibility.vro",
      blocking: false,
      priority: 20,
      timeout: 45,
    },
  });
});

test("update-subscription rejects a confirmed no-op", async () => {
  let updatedCall;
  const handlers = registeredSubscriptionTools({
    getSubscription: async (id) => ({ id, name: "Approval" }),
    updateSubscription: async (id, params) => {
      updatedCall = { id, params };
      return { id };
    },
  });

  // In vra8 mode an update is a full-element upsert, so a call that changes
  // nothing would still rewrite the live element.
  const noop = await handlers.get("update-subscription")({
    id: "sub-1",
    confirm: true,
  });
  assert.equal(noop.isError, true);
  assert.match(noop.content[0].text, /Nothing to update for subscription sub-1/);
  assert.equal(updatedCall, undefined);
});

test("delete-subscription requires confirmation", async () => {
  let deletedId;
  const handlers = registeredSubscriptionTools({
    deleteSubscription: async (id) => {
      deletedId = id;
    },
  });

  const refused = await handlers.get("delete-subscription")({
    id: "sub-1",
    confirm: false,
  });
  assert.equal(deletedId, undefined);
  assert.match(refused.content[0].text, /setting confirm to true/);

  await handlers.get("delete-subscription")({ id: "sub-1", confirm: true });
  assert.equal(deletedId, "sub-1");
});

test("subscription update and delete expected guards verify current target", async () => {
  let updatedCall;
  let deletedId;
  let reads = 0;
  const handlers = registeredSubscriptionTools({
    getSubscription: async (id) => {
      reads += 1;
      return {
        id,
        name: "Approval",
        eventTopicId: "topic-1",
        runnableId: "workflow-1",
      };
    },
    updateSubscription: async (id, params, current) => {
      updatedCall = { id, params, current };
      return { id, name: params.name ?? "Approval", disabled: params.disabled };
    },
    deleteSubscription: async (id) => {
      deletedId = id;
    },
  });

  const mismatch = await handlers.get("update-subscription")({
    id: "sub-1",
    expectedName: "Other approval",
    disabled: true,
    confirm: true,
  });
  assert.equal(mismatch.isError, true);
  assert.equal(updatedCall, undefined);

  reads = 0;
  await handlers.get("update-subscription")({
    id: "sub-1",
    expectedName: "Approval",
    expectedEventTopicId: "topic-1",
    disabled: true,
    confirm: true,
  });
  assert.deepEqual(updatedCall, {
    id: "sub-1",
    params: {
      name: undefined,
      description: undefined,
      disabled: true,
      runnableId: undefined,
      runnableType: undefined,
      blocking: undefined,
      priority: undefined,
      timeout: undefined,
    },
    // The snapshot the guard verified is handed to the client as the merge
    // base, so a guarded update reads the element once, not twice, and cannot
    // upsert a different snapshot than the one it checked.
    current: {
      id: "sub-1",
      name: "Approval",
      eventTopicId: "topic-1",
      runnableId: "workflow-1",
    },
  });
  assert.equal(reads, 1, "the guard read is reused as the merge base");

  const deleteMismatch = await handlers.get("delete-subscription")({
    id: "sub-1",
    expectedRunnableId: "workflow-2",
    confirm: true,
  });
  assert.equal(deleteMismatch.isError, true);
  assert.equal(deletedId, undefined);
});
