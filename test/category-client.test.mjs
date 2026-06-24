import assert from "node:assert/strict";
import test from "node:test";
import { CategoryClient } from "../dist/client/category-client.js";

// Stub the vRO HTTP client with a single /categories page. getAllVroPages stops
// once a page returns fewer items than the page size, so one short page suffices.
function httpStub(linkItems) {
  return {
    get: async () => ({ link: linkItems, total: linkItems.length }),
  };
}

test("listCategories maps a well-formed category including parent aliases", async () => {
  const client = new CategoryClient(
    httpStub([
      {
        attributes: [
          { name: "id", value: "cat-1" },
          { name: "name", value: "alpha" },
          { name: "description", value: "Alpha category" },
          { name: "type", value: "WorkflowCategory" },
          { name: "path", value: "/alpha" },
          { name: "parent-id", value: "root" },
          { name: "parentName", value: "Root" },
          { name: "parent-category-path", value: "/" },
        ],
      },
    ]),
  );

  const result = await client.listCategories("WorkflowCategory");
  assert.equal(result.link.length, 1);
  assert.deepEqual(result.link[0], {
    id: "cat-1",
    name: "alpha",
    description: "Alpha category",
    type: "WorkflowCategory",
    path: "/alpha",
    parentId: "root",
    parentName: "Root",
    parentPath: "/",
  });
});

test("listCategories falls back to empty strings for a malformed entry missing id/name", async () => {
  const client = new CategoryClient(
    httpStub([
      {
        attributes: [{ name: "description", value: "orphan" }],
      },
    ]),
  );

  const result = await client.listCategories("WorkflowCategory");
  assert.equal(result.link[0].id, "");
  assert.equal(result.link[0].name, "");
  // type still falls back to the requested categoryType.
  assert.equal(result.link[0].type, "WorkflowCategory");
});

test("listCategories omits absent parent fields rather than leaving them undefined", async () => {
  const client = new CategoryClient(
    httpStub([
      {
        attributes: [
          { name: "id", value: "cat-1" },
          { name: "name", value: "alpha" },
        ],
      },
    ]),
  );

  const result = await client.listCategories("WorkflowCategory");
  const category = result.link[0];
  assert.ok(!("parentId" in category));
  assert.ok(!("parentName" in category));
  assert.ok(!("parentPath" in category));
});

test("listCategories reads the @-prefixed id/name aliases", async () => {
  const client = new CategoryClient(
    httpStub([
      {
        attributes: [
          { name: "@id", value: "cat-9" },
          { name: "@name", value: "omega" },
        ],
      },
    ]),
  );

  const result = await client.listCategories("WorkflowCategory");
  assert.equal(result.link[0].id, "cat-9");
  assert.equal(result.link[0].name, "omega");
});
