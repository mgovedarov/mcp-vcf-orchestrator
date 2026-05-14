import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

test("MCP server version is read from package.json at runtime", () => {
  const built = readFileSync(resolve(root, "dist/index.js"), "utf8");

  // The built file must not contain a hardcoded version in the McpServer constructor.
  // It should use the SERVER_VERSION variable derived from package.json.
  assert.ok(
    !built.includes('{ name: "vcfa-server", version: "1.0.0" }'),
    "dist/index.js must not hardcode the server version"
  );

  // Verify createRequire is used to load package.json
  assert.ok(
    built.includes("createRequire"),
    "dist/index.js must use createRequire to load package.json"
  );
});

test("package.json version is a valid semver string", () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+/);
});
