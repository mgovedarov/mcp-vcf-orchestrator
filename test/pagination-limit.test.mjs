import assert from "node:assert";
import { test } from "node:test";
import {
  getAllVroPages,
  getAllAutomationPages,
  applyListLimit,
} from "../dist/client/pagination.js";

test("pagination: limit omitted => identical behavior to today", async () => {
  let calls = [];
  const http = {
    get: async (path) => {
      calls.push(path);
      const startIndex = new URL(`https://example.test${path}`).searchParams.get("startIndex");
      const start = parseInt(startIndex);
      return {
        link: start < 200 ? [{ id: `item-${start}` }] : [],
        total: 613,
        start: start,
      };
    },
  };
  const result = await getAllVroPages(http, "/workflows", new URLSearchParams());
  assert.ok(!("limited" in result), "limited should not be present when omitted");
  assert.ok(!("truncated" in result), "truncated should not be present on early break");
  assert.ok(calls[0].includes("maxResult=100"), "wire should have maxResult=100");
});

test("pagination: vRO with limit 5, total 613", async () => {
  let calls = [];
  const http = {
    get: async (path) => {
      calls.push(path);
      const maxResult = new URL(`https://example.test${path}`).searchParams.get("maxResult");
      const startIndex = new URL(`https://example.test${path}`).searchParams.get("startIndex");
      const start = parseInt(startIndex);
      return {
        link: start < 600 ? new Array(Math.min(parseInt(maxResult), 600 - start)).fill(null).map((_, i) => ({ id: `item-${start + i}` })) : [],
        total: 613,
        start: start,
      };
    },
  };
  const result = await getAllVroPages(http, "/workflows", new URLSearchParams(), { maxItems: 5 });
  assert.equal(result.link.length, 5, "should return 5 items");
  assert.equal(result.total, 613, "should preserve server total");
  assert.ok(result.limited, "should set limited flag");
  assert.ok(calls[0].includes("maxResult=6"), "should clamp pageSize to limit+1");
});

test("pagination: Automation with limit 5, total 613", async () => {
  let calls = [];
  const http = {
    get: async (path) => {
      calls.push(path);
      const size = new URL(`https://example.test${path}`).searchParams.get("size");
      const page = new URL(`https://example.test${path}`).searchParams.get("page");
      const pageNum = parseInt(page);
      const pageSize = parseInt(size);
      return {
        content: pageNum === 0 ? new Array(pageSize).fill(null).map((_, i) => ({ id: `item-${i}` })) : [],
        totalElements: 613,
        numberOfElements: pageNum === 0 ? pageSize : 0,
        last: pageNum > 0 ? true : false,
      };
    },
  };
  const result = await getAllAutomationPages(http, "/catalog/api/items", "https://example.test", new URLSearchParams(), { maxItems: 5 });
  assert.equal(result.content.length, 5, "should return 5 items");
  assert.equal(result.totalElements, 613, "should preserve server total");
  assert.ok(result.limited, "should set limited flag");
  assert.ok(calls[0].includes("size=6"), "should clamp size to limit+1");
});

test("pagination: applyListLimit", async () => {
  const items = [{ id: "1" }, { id: "2" }, { id: "3" }];
  const { items: i1, limited: l1, total: t1 } = applyListLimit(items, 5);
  assert.deepEqual(i1, items, "should not slice when limit > length");
  assert.ok(!l1, "limited should be false");
  assert.equal(t1, 3, "total should be 3");

  const { items: i2, limited: l2, total: t2 } = applyListLimit(items, 2);
  assert.equal(i2.length, 2, "should slice to limit");
  assert.ok(l2, "limited should be true");
  assert.equal(t2, 3, "total should still be 3");
});

test("pagination: both truncated and limited set", async () => {
  let pageCount = 0;
  const http = {
    get: async (path) => {
      pageCount += 1;
      const start = (pageCount - 1) * 1; // advance by 1 per page
      return {
        link: [{ id: `item-${start}` }], // different item each time
        total: 5000,
        start: start,
      };
    },
  };
  const result = await getAllVroPages(http, "/workflows", new URLSearchParams(), { maxItems: 2, maxPageRequests: 5 });
  assert.ok(result.limited, "should set limited flag");
  assert.equal(result.link.length, 2, "should have 2 limited items");
  assert.ok(!result.truncated, "should not set truncated when limit hit before maxPageRequests");
});
