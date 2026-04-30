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
  assert.match(detail.content[0].text, /"projectId": "project-1"/);
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
