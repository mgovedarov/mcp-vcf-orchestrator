import test from "node:test";
import assert from "node:assert/strict";

test("lockout drill: deliberately failing to prove red CI blocks the merge", () => {
  assert.equal(1, 2, "intentional failure - branch protection drill");
});
