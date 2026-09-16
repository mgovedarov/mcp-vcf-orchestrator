import assert from "node:assert/strict";
import test from "node:test";
import {
  REDACTED,
  containsSensitiveKey,
  isSensitiveKey,
  redactSensitiveValues,
} from "../dist/redaction.js";

test("isSensitiveKey matches the credential vocabulary case-insensitively", () => {
  for (const key of [
    "password",
    "adminPassword",
    "passwd",
    "clientSecret",
    "apiToken",
    "vaultToken",
    "credentials",
    "privateKey",
    "private_key",
    "API_KEY",
    "api-key",
  ]) {
    assert.equal(isSensitiveKey(key), true, `${key} should be sensitive`);
  }

  for (const key of ["hostname", "vmClass", "sshPublicKey", "count", "zone"]) {
    assert.equal(isSensitiveKey(key), false, `${key} should not be sensitive`);
  }
});

test("redactSensitiveValues withholds values at every depth", () => {
  const input = {
    hostname: "web-01",
    adminPassword: "must-not-print",
    nested: { user: "root", privateKey: "must-not-print" },
    list: [{ size: 20 }, { apiToken: "must-not-print" }],
  };

  const result = redactSensitiveValues(input);

  assert.deepEqual(result, {
    hostname: "web-01",
    adminPassword: REDACTED,
    nested: { user: "root", privateKey: REDACTED },
    list: [{ size: 20 }, { apiToken: REDACTED }],
  });
  assert.doesNotMatch(JSON.stringify(result), /must-not-print/);
  // The input is copied, never mutated: callers still hold the real values and
  // may need them (the guards compare against live metadata).
  assert.equal(input.adminPassword, "must-not-print");
});

test("redactSensitiveValues returns values it does not understand unchanged", () => {
  const date = new Date("2026-09-16T00:00:00.000Z");
  assert.equal(redactSensitiveValues("plain"), "plain");
  assert.equal(redactSensitiveValues(7), 7);
  assert.equal(redactSensitiveValues(null), null);
  assert.equal(redactSensitiveValues(undefined), undefined);
  // A class instance is not walked, so nothing can mangle a shape this module
  // does not model -- a Date survives as a Date rather than becoming {}.
  assert.equal(redactSensitiveValues(date), date);
});

test("containsSensitiveKey reports whether anything would be withheld", () => {
  // redactSensitiveValues copies every object it walks, so identity cannot
  // answer this: a caller comparing results would see a change either way.
  assert.equal(containsSensitiveKey({ hostname: "web-01" }), false);
  assert.equal(containsSensitiveKey({ adminPassword: "x" }), true);
  assert.equal(containsSensitiveKey({ a: { b: { token: "x" } } }), true);
  assert.equal(containsSensitiveKey([{ ok: 1 }, { secret: "x" }]), true);
  assert.equal(containsSensitiveKey([{ ok: 1 }]), false);
  assert.equal(containsSensitiveKey("password"), false);
  assert.equal(containsSensitiveKey(null), false);
});
