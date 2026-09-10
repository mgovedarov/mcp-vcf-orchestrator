import assert from "node:assert/strict";
import test from "node:test";
import {
  getAllAutomationPages,
  getAllVroPages,
} from "../dist/client/pagination.js";

function vroHttpStub(total) {
  return {
    get: async (path) => {
      const startIndex = Number(
        new URL(`https://example.test${path}`).searchParams.get("startIndex"),
      );
      return {
        link: startIndex < total ? [{ id: `item-${startIndex}` }] : [],
        start: startIndex,
        total,
      };
    },
  };
}

function automationHttpStub(total) {
  return {
    get: async (path) => {
      const page = Number(
        new URL(`https://example.test${path}`).searchParams.get("page"),
      );
      return {
        content: page < total ? [{ id: `item-${page}` }] : [],
        totalElements: total,
        last: page + 1 >= total,
      };
    },
  };
}

test("getAllVroPages flags truncation when the page request cap is reached", async () => {
  const result = await getAllVroPages(vroHttpStub(5), "/things", undefined, {
    pageSize: 1,
    maxPageRequests: 2,
  });

  assert.equal(result.link.length, 2);
  assert.equal(result.total, 5);
  assert.equal(result.truncated, true);
});

test("getAllVroPages omits truncated when pagination completes", async () => {
  const result = await getAllVroPages(vroHttpStub(3), "/things", undefined, {
    pageSize: 1,
  });

  assert.equal(result.link.length, 3);
  assert.equal(result.total, 3);
  assert.ok(!("truncated" in result));
});

test("getAllAutomationPages flags truncation when the page request cap is reached", async () => {
  const result = await getAllAutomationPages(
    automationHttpStub(5),
    "/things",
    "https://example.test",
    undefined,
    { pageSize: 1, maxPageRequests: 2 },
  );

  assert.equal(result.content.length, 2);
  assert.equal(result.numberOfElements, 2);
  assert.equal(result.totalElements, 5);
  assert.equal(result.truncated, true);
});

test("getAllAutomationPages throws when the server repeats a page without advancing", async () => {
  // Server always returns the same non-empty page and never reports `last` or
  // totals, so only the non-advancement guard can stop the loop.
  const repeatingStub = {
    get: async () => ({ content: [{ id: "stuck" }] }),
  };

  await assert.rejects(
    getAllAutomationPages(
      repeatingStub,
      "/things",
      "https://example.test",
      undefined,
      { pageSize: 1, maxPageRequests: 100 },
    ),
    /Automation pagination did not advance/,
  );
});

test("getAllAutomationPages omits truncated when the server reports the last page", async () => {
  const result = await getAllAutomationPages(
    automationHttpStub(3),
    "/things",
    "https://example.test",
    undefined,
    { pageSize: 1 },
  );

  assert.equal(result.content.length, 3);
  assert.equal(result.totalElements, 3);
  assert.ok(!("truncated" in result));
});

test("getAllVroPages reads items from alternative itemKeys and paginates a flat envelope", async () => {
  const requested = [];
  const flatStub = {
    get: async (path) => {
      const startIndex = Number(
        new URL(`https://example.test${path}`).searchParams.get("startIndex"),
      );
      requested.push(startIndex);
      return {
        plugins: startIndex < 3 ? [{ id: `plugin-${startIndex}` }] : [],
        total: 3,
      };
    },
  };

  const result = await getAllVroPages(flatStub, "/plugins", undefined, {
    pageSize: 1,
    itemKeys: ["link", "plugins"],
  });

  assert.deepEqual(
    result.link.map((item) => item.id),
    ["plugin-0", "plugin-1", "plugin-2"],
  );
  assert.equal(result.total, 3);
  assert.deepEqual(requested, [0, 1, 2]);
  assert.ok(!("truncated" in result));
});

test("getAllVroPages prefers link when both link and an alternative key are present", async () => {
  const stub = {
    get: async () => ({
      link: [{ id: "from-link" }],
      plugins: [{ id: "from-plugins" }],
      total: 1,
    }),
  };

  const result = await getAllVroPages(stub, "/plugins", undefined, {
    itemKeys: ["link", "plugins"],
  });

  assert.deepEqual(result.link, [{ id: "from-link" }]);
});

test("getAllVroPages ignores non-link arrays unless itemKeys names them", async () => {
  const stub = {
    get: async () => ({ plugins: [{ id: "plugin-0" }], total: 1 }),
  };

  const result = await getAllVroPages(stub, "/plugins");

  assert.deepEqual(result.link, []);
});
