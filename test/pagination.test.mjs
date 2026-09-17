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

test("getAllVroPages treats a negative total as unknown and keeps paginating", async () => {
  // vRA 8's embedded vRO reports total=-1 on /workflows when paged; a
  // negative total must not be mistaken for "0 or fewer items remain".
  const stub = {
    get: async (path) => {
      const startIndex = Number(
        new URL(`https://example.test${path}`).searchParams.get("startIndex"),
      );
      return {
        link: startIndex < 3 ? [{ id: `item-${startIndex}` }] : [],
        start: startIndex,
        total: -1,
      };
    },
  };

  const result = await getAllVroPages(stub, "/things", undefined, {
    pageSize: 1,
  });

  assert.deepEqual(
    result.link.map((item) => item.id),
    ["item-0", "item-1", "item-2"],
  );
  assert.equal(
    result.total,
    3,
    "falls back to the collected count instead of leaking the -1 sentinel",
  );
});

test("getAllAutomationPages treats a negative totalElements as unknown and keeps paginating", async () => {
  const stub = {
    get: async (path) => {
      const page = Number(
        new URL(`https://example.test${path}`).searchParams.get("page"),
      );
      return {
        content: page < 3 ? [{ id: `item-${page}` }] : [],
        totalElements: -1,
      };
    },
  };

  const result = await getAllAutomationPages(
    stub,
    "/things",
    "https://example.test",
    undefined,
    { pageSize: 1 },
  );

  assert.deepEqual(
    result.content.map((item) => item.id),
    ["item-0", "item-1", "item-2"],
  );
  assert.equal(
    result.totalElements,
    3,
    "falls back to the collected count instead of leaking the -1 sentinel",
  );
});

test("getAllAutomationPages reads a bare array body as a single complete page (VCFO-097)", async () => {
  // Automation services are inconsistent about the two shapes -- the sibling
  // /deployments/{id}/actions route answers a bare array on both platforms --
  // so a listing that switched arms must not render as an empty inventory.
  let requests = 0;
  const http = {
    get: async () => {
      requests += 1;
      return [{ id: "request-1" }, { id: "request-2" }];
    },
  };

  const result = await getAllAutomationPages(http, "/things", "https://example.test");

  assert.equal(requests, 1);
  assert.deepEqual(result.content, [{ id: "request-1" }, { id: "request-2" }]);
  assert.equal(result.numberOfElements, 2);
  assert.equal(result.totalElements, 2);
  assert.equal(result.truncated, undefined);
  assert.equal(result.limited, undefined);
});

test("getAllAutomationPages limits a bare array body and reports it (VCFO-097)", async () => {
  const http = {
    get: async () => [{ id: "request-1" }, { id: "request-2" }],
  };

  const result = await getAllAutomationPages(
    http,
    "/things",
    "https://example.test",
    undefined,
    { maxItems: 1 },
  );

  assert.deepEqual(result.content, [{ id: "request-1" }]);
  assert.equal(result.limited, true);
});

test("getAllAutomationPages throws when the list envelope is unrecognized (VCFO-098)", async () => {
  // The old vRA envelope VCF Automation 9.1 still serves on the blueprint
  // service when asked for apiVersion=2019-01-15. Reading `content` off it
  // yields nothing, which would render a populated environment as an empty
  // inventory instead of failing.
  const http = {
    get: async () => ({ count: 1, links: [], objects: [{ id: "blueprint-1" }] }),
  };

  await assert.rejects(
    () => getAllAutomationPages(http, "/blueprints", "https://example.test"),
    /unrecognized envelope[\s\S]*top-level keys: count, links, objects/,
  );
});

test("getAllAutomationPages names the endpoint it could not read (VCFO-098)", async () => {
  const http = { get: async () => ({ supportedApis: [], latestApiVersion: "x" }) };

  await assert.rejects(
    () => getAllAutomationPages(http, "/about", "https://example.test"),
    /Automation list response for \/about/,
  );
});

test("getAllAutomationPages reads an empty object body as a complete empty page (VCFO-098)", async () => {
  // An empty 2xx body reaches the walk as `{}` -- that is the transport
  // reporting no content, not an envelope this client failed to recognize, so
  // it must stay a clean empty result rather than becoming an error.
  let requests = 0;
  const http = {
    get: async () => {
      requests += 1;
      return {};
    },
  };

  const result = await getAllAutomationPages(http, "/things", "https://example.test");

  assert.equal(requests, 1);
  assert.deepEqual(result.content, []);
  assert.equal(result.numberOfElements, 0);
});

test("getAllAutomationPages reads a page carrying no content key as empty (VCFO-098)", async () => {
  // Paging metadata identifies a page even when the server omitted `content`
  // rather than sending an empty array, so this arm reports nothing found
  // instead of throwing.
  const http = {
    get: async () => ({ last: true, totalElements: 0, totalPages: 0 }),
  };

  const result = await getAllAutomationPages(http, "/things", "https://example.test");

  assert.deepEqual(result.content, []);
  assert.equal(result.numberOfElements, 0);
  assert.equal(result.totalElements, 0);
});

test("getAllAutomationPages throws when the list body is not an object (VCFO-098)", async () => {
  const http = { get: async () => "not json" };

  await assert.rejects(
    () => getAllAutomationPages(http, "/things", "https://example.test"),
    /was not an object or an array/,
  );
});
