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
