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

test("preflight-package formats reports and is read-only", async () => {
  const handlers = new Map();
  const configs = new Map();
  const server = {
    registerTool(name, config, handler) {
      configs.set(name, config);
      handlers.set(name, handler);
    },
  };
  registerPackageTools(server, {
    preflightPackageFile: async (fileName) => ({
      kind: "package",
      fileName,
      valid: true,
      errors: [],
      warnings: ["No nested artifacts were recognized"],
      metadata: { workflowArtifacts: 0 },
      entries: [{ name: "manifest.xml", size: 12 }],
      parameters: [],
      actionReferences: [],
    }),
  });

  assert.equal(configs.get("preflight-package").annotations.readOnlyHint, true);

  const result = await handlers.get("preflight-package")({
    fileName: "bundle.package",
  });
  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /preflight passed/);
  assert.match(result.content[0].text, /workflowArtifacts: 0/);
});
