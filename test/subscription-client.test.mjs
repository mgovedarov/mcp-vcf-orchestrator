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
