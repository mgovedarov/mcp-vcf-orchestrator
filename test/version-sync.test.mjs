import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/index.js");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

// Valid-looking env so the server starts the stdio transport and completes the
// handshake. Mirrors test/index-startup.test.mjs: the environment is passed
// explicitly rather than inherited, so a developer's own VCFA_* vars cannot
// influence the run. StdioClientTransport spawns the child itself and replaces
// the default inherited set when `env` is given, so PATH must be listed.
const validEnv = {
  PATH: process.env.PATH,
  VCFA_HOST: "vcfa.example.test",
  VCFA_USERNAME: "user",
  VCFA_ORGANIZATION: "system",
  VCFA_PASSWORD: "secret",
};

// This is the repository's only test that speaks MCP over the wire, and it must
// stay a HANDSHAKE ONLY — never add a `tools/call`. Login is lazy (deferred to
// the first tool call), which is the sole reason running the built server here
// contacts no network and keeps `npm run validate` off a live VCFA environment.
//
// `initialize` is also all this needs: serverInfo is carried in its result.
test("the built server reports package.json's version over MCP", async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: validEnv,
    // Keep the server's startup lines ("[vcfa-server] ...", "MCP server
    // started") out of the test runner's TAP stream.
    stderr: "pipe",
  });
  const client = new Client({ name: "version-sync-test", version: "1.0.0" });

  t.after(async () => {
    await client.close();
  });

  await client.connect(transport);

  const info = client.getServerVersion();
  // Typed `Implementation | undefined`. Assert presence first, so a handshake
  // that did not populate serverInfo fails as a missing handshake rather than
  // as a TypeError on the next line.
  assert.ok(info, "server did not report serverInfo in the initialize result");
  assert.equal(
    info.version,
    pkg.version,
    "the version reported over MCP must equal package.json's version",
  );
  // Registered clients key on this name; a rename is a breaking change.
  assert.equal(info.name, "vcfa-server");
});

test("package.json version is a valid semver string", () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+/);
});
