import assert from "node:assert/strict";
import test from "node:test";
import { parseAttrs, getLinkAttrs } from "../dist/client/attrs.js";

test("parseAttrs converts a name/value array to a plain object", () => {
  assert.deepEqual(
    parseAttrs([
      { name: "id", value: "cat-1" },
      { name: "name", value: "alpha" },
    ]),
    { id: "cat-1", name: "alpha" },
  );
});

test("parseAttrs preserves later values when a name repeats", () => {
  assert.deepEqual(
    parseAttrs([
      { name: "name", value: "first" },
      { name: "name", value: "second" },
    ]),
    { name: "second" },
  );
});

test("parseAttrs returns an empty object for undefined input", () => {
  assert.deepEqual(parseAttrs(undefined), {});
});

test("parseAttrs skips entries with a missing or non-string name", () => {
  const result = parseAttrs([
    { name: "id", value: "cat-1" },
    // Missing name — would otherwise produce an "undefined" key.
    { value: "orphan" },
    // Non-string names must not be coerced into keys.
    { name: 42, value: "number-name" },
    { name: { nested: true }, value: "object-name" },
    { name: null, value: "null-name" },
    { name: "name", value: "alpha" },
  ]);
  assert.deepEqual(result, { id: "cat-1", name: "alpha" });
  assert.ok(!("undefined" in result));
});

test("parseAttrs skips null/undefined elements without throwing", () => {
  const result = parseAttrs([null, undefined, { name: "id", value: "cat-1" }]);
  assert.deepEqual(result, { id: "cat-1" });
});

test("getLinkAttrs prefers the `attribute` field over `attributes`", () => {
  assert.deepEqual(
    getLinkAttrs({
      attribute: [{ name: "id", value: "from-attribute" }],
      attributes: [{ name: "id", value: "from-attributes" }],
    }),
    { id: "from-attribute" },
  );
});

test("getLinkAttrs falls back to the `attributes` field", () => {
  assert.deepEqual(
    getLinkAttrs({ attributes: [{ name: "id", value: "from-attributes" }] }),
    { id: "from-attributes" },
  );
});
