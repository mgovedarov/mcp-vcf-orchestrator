import assert from "node:assert/strict";
import test from "node:test";
import { SubscriptionClient } from "../dist/client/subscription-client.js";

function captureHttp() {
  const calls = [];
  return {
    calls,
    http: {
      eventBrokerBaseUrl: "https://eventbroker.test",
      get: async (path) => {
        calls.push(path);
        return { content: [], last: true, totalElements: 0 };
      },
    },
  };
}

test("listSubscriptions escapes single quotes in the projectId OData filter", async () => {
  const { http, calls } = captureHttp();
  const client = new SubscriptionClient(http);

  await client.listSubscriptions("o'brien");

  const url = new URL(`https://eventbroker.test${calls[0]}`);
  // OData escapes a single quote by doubling it.
  assert.equal(url.searchParams.get("$filter"), "projectId eq 'o''brien'");
});

test("listSubscriptions omits the filter when no projectId is given", async () => {
  const { http, calls } = captureHttp();
  const client = new SubscriptionClient(http);

  await client.listSubscriptions();

  const url = new URL(`https://eventbroker.test${calls[0]}`);
  assert.equal(url.searchParams.has("$filter"), false);
});

// The vcfa path must stay byte-identical to what it shipped: VCFA 9.x assigns
// the subscription id and serves PUT on the element, and neither was re-verified
// under VCFO-070, so only the vra8 branch changed.
function captureWrites(targetPlatform, element = { id: "subscription-1" }) {
  const calls = [];
  return {
    calls,
    http: {
      targetPlatform,
      eventBrokerBaseUrl: "https://eventbroker.test",
      get: async (path) => {
        calls.push({ method: "GET", path });
        return element;
      },
      post: async (path, body) => {
        calls.push({ method: "POST", path, body });
        return element;
      },
      put: async (path, body) => {
        calls.push({ method: "PUT", path, body });
        return element;
      },
    },
  };
}

test("createSubscription on vcfa posts without an id and returns the response", async () => {
  const { http, calls } = captureWrites("vcfa");
  const client = new SubscriptionClient(http);

  await client.createSubscription({
    name: "Subscription",
    eventTopicId: "topic-1",
    runnableType: "extensibility.vro",
    runnableId: "runnable-1",
  });

  assert.deepEqual(
    calls.map((c) => c.method),
    ["POST"],
    "no read-back on vcfa: the response carries the created element",
  );
  assert.ok(!("id" in calls[0].body), "VCFA 9.x assigns the id");
  assert.equal(calls[0].body.type, "RUNNABLE");
});

test("updateSubscription on vcfa puts only the supplied fields", async () => {
  const { http, calls } = captureWrites("vcfa");
  const client = new SubscriptionClient(http);

  await client.updateSubscription("subscription-1", { disabled: true });

  assert.deepEqual(calls, [
    {
      method: "PUT",
      path: "/subscriptions/subscription-1",
      body: { disabled: true },
    },
  ]);
});

test("updateSubscription on vra8 reads, merges, upserts, and re-reads", async () => {
  const { http, calls } = captureWrites("vra8", {
    id: "subscription-1",
    name: "Existing",
    eventTopicId: "topic-1",
    runnableType: "extensibility.vro",
    runnableId: "runnable-1",
    blocking: false,
    disabled: false,
  });
  const client = new SubscriptionClient(http);

  await client.updateSubscription("subscription-1", { disabled: true });

  assert.deepEqual(
    calls.map((c) => c.method),
    ["GET", "POST", "GET"],
  );
  assert.equal(calls[1].path, "/subscriptions");
  assert.equal(calls[1].body.disabled, true);
  assert.equal(calls[1].body.name, "Existing");
});
