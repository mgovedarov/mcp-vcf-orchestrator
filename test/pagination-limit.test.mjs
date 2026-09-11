import assert from "node:assert";
import { test } from "node:test";
import {
  getAllVroPages,
  getAllAutomationPages,
  applyListLimit,
} from "../dist/client/pagination.js";
import { limitNote } from "../dist/tools/list-limit.js";

function pagedInventory(kind, count, { known = true, ...options } = {}) {
  const calls = [];
  const http = {
    get: async (path) => {
      const params = new URL(`https://example.test${path}`).searchParams;
      const size = Number(params.get(kind === "vro" ? "maxResult" : "size"));
      const start = kind === "vro"
        ? Number(params.get("startIndex"))
        : Number(params.get("page")) * size;
      calls.push({ start, size });
      const items = Array.from({ length: Math.min(size, Math.max(0, count - start)) },
        (_, index) => ({ id: start + index }));
      return kind === "vro"
        ? { link: items, total: known ? count : -1 }
        : { content: items, totalElements: known ? count : -1 };
    },
  };
  return {
    calls,
    run: () => kind === "vro"
      ? getAllVroPages(http, "/things", undefined, options)
      : getAllAutomationPages(http, "/things", "https://example.test", undefined, options),
  };
}

for (const kind of ["vro", "automation"]) {
  const rows = (result) => result.link ?? result.content;
  const total = (result) => result.total ?? result.totalElements;

  test(`${kind}: unknown partial totals are not lookahead counts`, async () => {
    const fixture = pagedInventory(kind, 613, { known: false, maxItems: 5 });
    const result = await fixture.run();
    assert.equal(rows(result).length, 5);
    assert.equal(total(result), undefined);
    assert.equal(result.limited, true);
    assert.equal(result.truncated, undefined);
    assert.deepEqual(fixture.calls, [{ start: 0, size: 5 }, { start: 5, size: 5 }]);
    assert.doesNotMatch(limitNote(result, 5, total(result)), / of /);
    assert.match(limitNote(result, 5), /More matching results exist/);
  });

  for (const known of [true, false]) {
    for (const count of [0, 3, 5]) {
      test(`${kind}: complete count ${count}, known=${known}`, async () => {
        const fixture = pagedInventory(kind, count, { known, maxItems: 5 });
        const result = await fixture.run();
        assert.equal(rows(result).length, count);
        assert.equal(total(result), count);
        assert.equal(result.limited, undefined);
        assert.equal(result.truncated, undefined);
        assert.equal(fixture.calls.length, !known && count === 5 ? 2 : 1);
        assert.equal(limitNote(result, count, total(result)), "");
      });
    }
  }

  for (const maxItems of [1, 25, 1000]) {
    test(`${kind}: multi-page limit ${maxItems} keeps a stable size`, async () => {
      const fixture = pagedInventory(kind, 2000, { maxItems, pageSize: 10 });
      const result = await fixture.run();
      assert.equal(rows(result).length, maxItems);
      assert.equal(total(result), 2000);
      assert.equal(result.limited, true);
      assert.deepEqual(fixture.calls, Array.from({ length: Math.ceil(maxItems / 10) },
        (_, index) => ({ start: index * Math.min(maxItems, 10), size: Math.min(maxItems, 10) })));
    });
  }

  test(`${kind}: local filtering counts matches but advances through raw rows`, async () => {
    const fixture = pagedInventory(kind, 100, {
      maxItems: 2,
      itemFilter: (item) => item.id >= 6 && item.id % 2 === 0,
    });
    const result = await fixture.run();
    assert.deepEqual(rows(result), [{ id: 6 }, { id: 8 }]);
    assert.equal(total(result), undefined);
    assert.equal(result.limited, true);
    assert.deepEqual(fixture.calls.map((call) => call.start), [0, 2, 4, 6, 8, 10]);
  });

  test(`${kind}: complete local matches have an exact matching total`, async () => {
    const fixture = pagedInventory(kind, 10, { maxItems: 2, itemFilter: (item) => item.id >= 8 });
    const result = await fixture.run();
    assert.deepEqual(rows(result), [{ id: 8 }, { id: 9 }]);
    assert.equal(total(result), 2);
    assert.equal(result.limited, undefined);
    assert.equal(fixture.calls.length, 5);
  });

  test(`${kind}: cap before limit is not a caller limit`, async () => {
    const fixture = pagedInventory(kind, 100, { maxItems: 5, pageSize: 1, maxPageRequests: 2 });
    const result = await fixture.run();
    assert.equal(rows(result).length, 2);
    assert.equal(result.truncated, true);
    assert.equal(result.limited, undefined);
    assert.equal(total(result), 100);
  });

  test(`${kind}: capped unproven boundary stays truncated, not limited`, async () => {
    const fixture = pagedInventory(kind, 100, { known: false, maxItems: 2, maxPageRequests: 1 });
    const result = await fixture.run();
    assert.equal(rows(result).length, 2);
    assert.equal(total(result), undefined);
    assert.equal(result.truncated, true);
    assert.equal(result.limited, undefined);
  });

  test(`${kind}: a limit or exhaustion on the final allowed request is not truncation`, async () => {
    for (const count of [2, 100]) {
      const fixture = pagedInventory(kind, count, { maxItems: 2, maxPageRequests: 1 });
      const result = await fixture.run();
      assert.equal(result.truncated, undefined);
      assert.equal(Boolean(result.limited), count > 2);
    }
  });

  test(`${kind}: raw repeats are detected even when no items match`, async () => {
    const http = { get: async () => ({ link: [{ id: 0 }], content: [{ id: 0 }] }) };
    const options = { maxItems: 1, itemFilter: () => false };
    await assert.rejects(kind === "vro"
      ? getAllVroPages(http, "/things", undefined, options)
      : getAllAutomationPages(http, "/things", "https://example.test", undefined, options), /did not advance/);
  });

  test(`${kind}: omitted limit preserves complete objects and default requests`, async () => {
    const fixture = pagedInventory(kind, 201);
    const result = await fixture.run();
    const items = Array.from({ length: 201 }, (_, id) => ({ id }));
    assert.deepEqual(result, kind === "vro"
      ? { link: items, total: 201 }
      : { content: items, totalElements: 201, numberOfElements: 201 });
    assert.deepEqual(fixture.calls, [0, 100, 200].map((start) => ({ start, size: 100 })));
  });
}

test("vRO limit preserves queryCount fallback and alternate item keys", async () => {
  const calls = [];
  const http = { get: async (path) => {
    calls.push(path);
    const params = new URL(`https://example.test${path}`).searchParams;
    if (params.has("queryCount")) throw new Error("isQueryCount is not implemented");
    const start = Number(params.get("startIndex"));
    return { plugins: [{ id: start }], total: -1 };
  } };
  const result = await getAllVroPages(http, "/plugins", undefined, { maxItems: 1, itemKeys: ["plugins"] });
  assert.deepEqual(result, { link: [{ id: 0 }], limited: true });
  assert.equal(calls.length, 3);
  assert.match(calls[0], /queryCount=true/);
  assert.doesNotMatch(calls[1], /queryCount/);
  assert.match(calls[2], /startIndex=1/);
});

test("Automation terminal metadata avoids unnecessary boundary probes", async () => {
  for (const metadata of [{ last: true }, { totalPages: 1 }]) {
    let calls = 0;
    const http = { get: async () => {
      calls += 1;
      return { content: [{ id: 1 }], ...metadata };
    } };
    const result = await getAllAutomationPages(http, "/things", "https://example.test", undefined, { maxItems: 1 });
    assert.deepEqual(result, { content: [{ id: 1 }], numberOfElements: 1, totalElements: 1 });
    assert.equal(calls, 1);
  }
});

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
  assert.ok(calls[0].includes("maxResult=5"), "should clamp pageSize to limit");
  assert.equal(calls.length, 1);
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
  assert.ok(calls[0].includes("size=5"), "should clamp size to limit");
  assert.equal(calls.length, 1);
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
