import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../dist/index.js");

// Run the built server with an explicitly controlled environment so unset
// required vars are genuinely absent (not inherited from the dev's shell).
// Both scenarios exit(1) before the stdio transport connects, so neither hangs.
function runServer(env) {
  return spawnSync(process.execPath, [entry], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
    timeout: 15_000,
  });
}

test("entry point exits with an error when a required env var is missing", () => {
  const result = runServer({
    // VCFA_HOST intentionally omitted.
    VCFA_USERNAME: "user",
    VCFA_ORGANIZATION: "system",
    VCFA_PASSWORD: "secret",
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Required environment variable VCFA_HOST is not set/,
  );
});

test("entry point exits with an error on an invalid VCFA_TARGET_PLATFORM", () => {
  const result = runServer({
    VCFA_HOST: "vcfa.example.test",
    VCFA_USERNAME: "user",
    VCFA_ORGANIZATION: "system",
    VCFA_PASSWORD: "secret",
    VCFA_TARGET_PLATFORM: "bogus-platform",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /VCFA_TARGET_PLATFORM must be one of/);
});
