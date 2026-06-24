import assert from "node:assert/strict";
import test from "node:test";
import { ResourceClient } from "../dist/client/resource-client.js";

function resourceClient() {
  // getResourceElement only depends on listResources(), so the http dependency
  // is unused here.
  return new ResourceClient({});
}

test("getResourceElement returns the matching element", async () => {
  const client = resourceClient();
  client.listResources = async () => ({
    link: [
      { id: "r1", name: "Logo" },
      { id: "r2", name: "Banner" },
    ],
    total: 2,
  });

  const element = await client.getResourceElement("r2");
  assert.deepEqual(element, { id: "r2", name: "Banner" });
});

test("getResourceElement reports a plain not-found when the list is complete", async () => {
  const client = resourceClient();
  client.listResources = async () => ({
    link: [{ id: "r1", name: "Logo" }],
    total: 1,
  });

  await assert.rejects(
    client.getResourceElement("missing"),
    /Resource element not found: missing/,
  );
});

test("getResourceElement surfaces truncation instead of a misleading not-found", async () => {
  const client = resourceClient();
  client.listResources = async () => ({
    link: [{ id: "r1", name: "Logo" }],
    total: 1,
    truncated: true,
  });

  await assert.rejects(
    client.getResourceElement("r999"),
    /truncated at the page-request cap/,
  );
});
