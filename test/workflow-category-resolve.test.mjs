import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkflowCategoryFromList } from "../dist/client/workflow-client.js";

const categories = [
  { id: "cat-1", name: "alpha", path: "/alpha" },
  { id: "cat-2", name: "beta", path: "/beta" },
];

test("resolveWorkflowCategoryFromList returns the matching category by id", () => {
  const match = resolveWorkflowCategoryFromList(
    categories,
    { categoryId: "cat-2" },
    false,
  );
  assert.equal(match?.id, "cat-2");
});

test("resolveWorkflowCategoryFromList reports a plain not-found when the list is complete", () => {
  assert.throws(
    () =>
      resolveWorkflowCategoryFromList(categories, { categoryId: "missing" }, false),
    (error) => {
      assert.match(error.message, /No WorkflowCategory found with id: missing/);
      assert.doesNotMatch(error.message, /truncated/);
      return true;
    },
  );
});

test("resolveWorkflowCategoryFromList flags truncation when an absent id may lie beyond the page cap", () => {
  assert.throws(
    () =>
      resolveWorkflowCategoryFromList(categories, { categoryId: "missing" }, true),
    /truncated at the page-request cap/,
  );
});
