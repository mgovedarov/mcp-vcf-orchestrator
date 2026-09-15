import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../dist/index.js");

// Run the built server with an explicitly controlled environment so unset
// required vars are genuinely absent (not inherited from the dev's shell).
// The exit(1) scenarios finish before the stdio transport connects, so none hangs.
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
//
// We exercise SIGTERM — the signal process managers and MCP clients use to stop
// the server. The assertion checks the EXIT CODE, not the "Shutting down" log:
// the handler logs and then calls process.exit(0), which can truncate the final
// (asynchronous) stderr pipe write before the parent reads it, so the log is
// best-effort under load. Exit code 0 is the reliable contract — a signal's
// default disposition terminates with a non-zero/signalled status, so a clean
// 0 proves our graceful shutdown() ran to completion. The shutdown() body is
// signal-agnostic, so this also covers the SIGINT registration.
function runUntilStarted(signal, extraEnv = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [entry], {
      env: { PATH: process.env.PATH, ...validEnv, ...extraEnv },
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
  // Exit code 0 (not signal-terminated) proves the graceful shutdown handler
  // ran and reached process.exit(0). See runUntilStarted for why the log line
  // itself is not asserted.
  const { code } = await runUntilStarted("SIGTERM");
  assert.equal(code, 0);
});

test("entry point exits with an error when VCFA_HOST carries a URL scheme", () => {
  const result = runServer({ ...validEnv, VCFA_HOST: "https://vcfa.example.test" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /VCFA_HOST must be a hostname or host:port/);
});

test("entry point treats a whitespace-only VCFA_HOST as missing", () => {
  const result = runServer({ ...validEnv, VCFA_HOST: "   " });
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Required environment variable VCFA_HOST is not set/,
  );
});

test("entry point rejects a VCFA_VRO_HOST that is a URL or carries a path", () => {
  for (const value of [
    "https://vro.example.test",
    "vro.example.test/vco",
    "user@vro.example.test",
  ]) {
    const result = runServer({ ...validEnv, VCFA_VRO_HOST: value });
    assert.equal(result.status, 1, value);
    assert.match(
      result.stderr,
      /VCFA_VRO_HOST must be a hostname or host:port/,
      value,
    );
  }
});

test("entry point reports the external vRO host routing at startup", async () => {
  // The routing line is written before "MCP server started", which
  // runUntilStarted waits for, so it is reliably in the captured stderr.
  const { code, stderr } = await runUntilStarted("SIGTERM", {
    VCFA_VRO_HOST: "vro.example.test",
  });
  assert.equal(code, 0);
  assert.match(
    stderr,
    /\[vcfa-server\] VCFA_VRO_HOST=vro\.example\.test: vRO API requests \(\/vco\/api\) are sent to this host; authentication and the Automation services use VCFA_HOST=vcfa\.example\.test\./,
  );
});

test("entry point treats a blank VCFA_VRO_HOST as unset", async () => {
  const { code, stderr } = await runUntilStarted("SIGTERM", {
    VCFA_VRO_HOST: "   ",
  });
  assert.equal(code, 0);
  assert.ok(!stderr.includes("VCFA_VRO_HOST="), stderr);
});

test("entry point treats a VCFA_VRO_HOST equal to VCFA_HOST as unset", async () => {
  // No split, so no routing line — matching the client, which ignores an
  // override equal to the Automation host.
  const { code, stderr } = await runUntilStarted("SIGTERM", {
    VCFA_VRO_HOST: validEnv.VCFA_HOST,
  });
  assert.equal(code, 0);
  assert.ok(!stderr.includes("VCFA_VRO_HOST="), stderr);
});
