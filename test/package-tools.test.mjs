import assert from "node:assert/strict";
import test from "node:test";
import { registerPackageTools } from "../dist/tools/package-tools.js";

function registeredPackageTools(client) {
  const handlers = new Map();
  const server = {
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
  };
  registerPackageTools(server, client);
  return handlers;
}

test("delete-package refuses to submit unless confirmed", async () => {
  let calls = 0;
  const handlers = registeredPackageTools({
    deletePackage: async () => {
      calls += 1;
    },
  });

  const result = await handlers.get("delete-package")({
    name: "com.example",
    deleteContents: true,
    confirm: false,
  });

  assert.equal(calls, 0);
  assert.match(result.content[0].text, /setting confirm to true/);
});

test("delete-package deletes only after confirmation", async () => {
  let deleted;
  const handlers = registeredPackageTools({
    deletePackage: async (name, deleteContents) => {
      deleted = { name, deleteContents };
    },
  });

  const result = await handlers.get("delete-package")({
    name: "com.example",
    deleteContents: true,
    confirm: true,
  });

  assert.deepEqual(deleted, { name: "com.example", deleteContents: true });
  assert.match(result.content[0].text, /including contents/);
});
