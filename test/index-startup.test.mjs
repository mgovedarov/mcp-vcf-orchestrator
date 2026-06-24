import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
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

// Valid-looking env so the server starts the stdio transport and waits. Login is
// lazy (deferred to the first tool call), so no network is contacted at startup.
const validEnv = {
  VCFA_HOST: "vcfa.example.test",
  VCFA_USERNAME: "user",
  VCFA_ORGANIZATION: "system",
  VCFA_PASSWORD: "secret",
};

// Start the server, wait until it reports the transport is up, then deliver
// `signal`. Resolves with the exit code and accumulated stderr. A hard timeout
// SIGKILLs and rejects so a regression that fails to shut down can't hang CI.
function runUntilStarted(signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [entry], {
      env: { PATH: process.env.PATH, ...validEnv },
    });
    let stderr = "";
    let signalled = false;

    const killTimer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(
        new Error(
          `server did not exit after ${signal} within timeout; stderr:\n${stderr}`,
        ),
      );
    }, 10_000);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (!signalled && stderr.includes("MCP server started")) {
        signalled = true;
        child.kill(signal);
      }
    });
    child.on("error", (error) => {
      clearTimeout(killTimer);
      rejectPromise(error);
    });
    child.on("exit", (code) => {
      clearTimeout(killTimer);
      resolvePromise({ code, stderr });
    });
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

test("entry point shuts down gracefully on SIGTERM", async () => {
  const { code, stderr } = await runUntilStarted("SIGTERM");
  assert.match(stderr, /Shutting down \(SIGTERM\)/);
  assert.equal(code, 0);
});

test("entry point shuts down gracefully on SIGINT", async () => {
  const { code, stderr } = await runUntilStarted("SIGINT");
  assert.match(stderr, /Shutting down \(SIGINT\)/);
  assert.equal(code, 0);
});
