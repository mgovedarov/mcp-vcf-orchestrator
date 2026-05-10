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
    exportPackage: async (name, fileName, overwrite, options) => {
      exported = { name, fileName, overwrite, options };
      return `/tmp/packages/${fileName}`;
    },
    importPackageWithOptions: async (fileName, options) => {
      imported = { fileName, options };
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
    options: {
      exportConfigurationAttributeValues: undefined,
      exportGlobalTags: undefined,
      exportVersionHistory: undefined,
      exportConfigSecureStringAttributeValues: undefined,
    },
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
    options: {
      overwrite: false,
      importConfigurationAttributeValues: undefined,
      tagImportMode: undefined,
      importConfigSecureStringAttributeValues: undefined,
    },
  });
});

test("project package tools reuse exact package and require confirmation to create", async () => {
  const calls = [];
  const handlers = registeredPackageTools({
    ensureProjectPackage: async (params) => {
      calls.push(params);
      if (params.createIfMissing && params.confirm) {
        return { name: params.packageName, created: true };
      }
      return {
        name: params.packageName,
        created: false,
        package: { description: "Project package" },
      };
    },
  });

  const reused = await handlers.get("ensure-project-package")({
    packageName: "com.example.project",
  });
  assert.match(reused.content[0].text, /Status: reused/);

  const created = await handlers.get("ensure-project-package")({
    packageName: "com.example.project",
    createIfMissing: true,
    confirm: true,
  });
  assert.match(created.content[0].text, /Status: created/);
  assert.deepEqual(calls, [
    {
      packageName: "com.example.project",
      description: undefined,
      createIfMissing: undefined,
      confirm: undefined,
    },
    {
      packageName: "com.example.project",
      description: undefined,
      createIfMissing: true,
      confirm: true,
    },
  ]);
});

test("add project package content gates live package mutation", async () => {
  let added;
  let ensureParams;
  const handlers = registeredPackageTools({
    ensureProjectPackage: async (params) => {
      ensureParams = params;
      return {
        name: params.packageName,
        created: false,
      };
    },
    addWorkflowToPackage: async (packageName, workflowId) => {
      added = { packageName, workflowId };
    },
  });

  const refused = await handlers.get("add-workflow-to-project-package")({
    packageName: "com.example.project",
    workflowId: "workflow-1",
    confirm: false,
  });
  assert.equal(added, undefined);
  assert.match(refused.content[0].text, /Confirm adding workflow/);

  await handlers.get("add-workflow-to-project-package")({
    packageName: "com.example.project",
    workflowId: "workflow-1",
    createIfMissing: true,
    confirm: true,
  });
  assert.deepEqual(ensureParams, { packageName: "com.example.project" });
  assert.deepEqual(added, {
    packageName: "com.example.project",
    workflowId: "workflow-1",
  });
});

test("project package import details and import do not require live package lookup", async () => {
  let ensureCalls = 0;
  let importDetailsFileName;
  let imported;
  const handlers = registeredPackageTools({
    resolveProjectPackageName: (packageName) => packageName ?? "com.example.project",
    ensureProjectPackage: async () => {
      ensureCalls += 1;
      throw new Error("should not check live package");
    },
    getPackageImportDetails: async (fileName) => {
      importDetailsFileName = fileName;
      return {
        packageName: "com.example.project",
        contentVerified: true,
        importElementDetails: [{ id: "workflow-1" }],
      };
    },
    importPackageWithOptions: async (fileName, options) => {
      imported = { fileName, options };
    },
  });

  const details = await handlers.get("get-project-package-import-details")({
    packageName: "com.example.project",
  });
  assert.equal(importDetailsFileName, "com.example.project.package");
  assert.match(details.content[0].text, /Elements: 1/);

  await handlers.get("import-project-package")({
    packageName: "com.example.project",
    confirm: true,
    overwrite: false,
  });

  assert.equal(ensureCalls, 0);
  assert.deepEqual(imported, {
    fileName: "com.example.project.package",
    options: {
      overwrite: false,
      importConfigurationAttributeValues: undefined,
      tagImportMode: undefined,
      importConfigSecureStringAttributeValues: undefined,
    },
  });
});

test("import-project-package rejects package files for a different package", async () => {
  let imported;
  const handlers = registeredPackageTools({
    resolveProjectPackageName: (packageName) => packageName ?? "com.example.project",
    getPackageImportDetails: async () => ({
      packageName: "com.example.other",
      contentVerified: true,
    }),
    importPackageWithOptions: async (fileName, options) => {
      imported = { fileName, options };
    },
  });

  const result = await handlers.get("import-project-package")({
    packageName: "com.example.project",
    fileName: "com.example.other.package",
    confirm: true,
  });

  assert.equal(imported, undefined);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /contains 'com\.example\.other'/);
  assert.match(result.content[0].text, /project package 'com\.example\.project'/);
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
