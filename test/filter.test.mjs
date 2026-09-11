import assert from "node:assert/strict";
import test from "node:test";
import { matchesFilter, normalizeFilter } from "../dist/client/filter.js";

// One normalization for every client-side list filter (VCFO-071): trimmed,
// lower-cased, blank treated as absent.
test("normalizeFilter trims, lower-cases, and drops blank filters", () => {
  assert.equal(normalizeFilter(" Library "), "library");
  assert.equal(normalizeFilter("   "), undefined);
  assert.equal(normalizeFilter(""), undefined);
  assert.equal(normalizeFilter(undefined), undefined);
});

test("matchesFilter is a case-insensitive substring match that never matches a missing value", () => {
  assert.equal(matchesFilter("com.example.Library", "library"), true);
  assert.equal(matchesFilter("Other", "library"), false);
  assert.equal(matchesFilter(undefined, "library"), false);
});
