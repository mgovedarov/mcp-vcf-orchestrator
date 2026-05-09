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

function registeredPackageToolsWithConfigs(client) {
  const handlers = new Map();
  const configs = new Map();
  const server = {
    registerTool(name, config, handler) {
      configs.set(name, config);
      handlers.set(name, handler);
    },
  };
  registerPackageTools(server, client);
  return { handlers, configs };
}

test("package list and get tools are read-only and format metadata", async () => {
  const { handlers, configs } = registeredPackageToolsWithConfigs({
    listPackages: async (filter) => ({
      link: [
        {
          name: `com.example.${filter}`,
          version: "1.2.3",
          description: "Example package",
        },
      ],
    }),
    getPackage: async (name) => ({
      name,
      version: "1.2.3",
      description: "Example package",
    }),
  });

  assert.equal(configs.get("list-packages").annotations.readOnlyHint, true);
  assert.equal(configs.get("get-package").annotations.readOnlyHint, true);

  const list = await handlers.get("list-packages")({ filter: "demo" });
  assert.match(list.content[0].text, /com\.example\.demo v1\.2\.3/);
  assert.match(list.content[0].text, /Example package/);

  const detail = await handlers.get("get-package")({
    name: "com.example.demo",
  });
  assert.match(detail.content[0].text, /Package: com\.example\.demo/);
  assert.match(detail.content[0].text, /Version: 1\.2\.3/);
});

test("package export and import delegate paths and confirmation", async () => {
  let exported;
  let imported;
  const handlers = registeredPackageTools({
    getPackageDirectory: () => "/tmp/packages",
    exportPackage: async (name, fileName, overwrite) => {
      exported = { name, fileName, overwrite };
      return `/tmp/packages/${fileName}`;
    },
    importPackage: async (fileName, overwrite) => {
      imported = { fileName, overwrite };
    },
  });

  const exportResult = await handlers.get("export-package")({
    name: "com.example.demo",
    fileName: "com.example.demo.package",
    overwrite: true,
  });
  assert.deepEqual(exported, {
    name: "com.example.demo",
    fileName: "com.example.demo.package",
    overwrite: true,
  });
  assert.match(exportResult.content[0].text, /exported successfully/);

  const refused = await handlers.get("import-package")({
    fileName: "com.example.demo.package",
    confirm: false,
  });
  assert.equal(imported, undefined);
  assert.match(refused.content[0].text, /\/tmp\/packages/);

  await handlers.get("import-package")({
    fileName: "com.example.demo.package",
    overwrite: false,
    confirm: true,
  });
  assert.deepEqual(imported, {
    fileName: "com.example.demo.package",
    overwrite: false,
  });
});

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
