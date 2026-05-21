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

test("package list and get tools report empty lists and client errors", async () => {
  const handlers = registeredPackageTools({
    listPackages: async () => ({ link: [] }),
    getPackage: async () => {
      throw new Error("package lookup failed");
    },
  });

  const empty = await handlers.get("list-packages")({});
  assert.match(empty.content[0].text, /No packages found/);

  const detail = await handlers.get("get-package")({
    name: "com.example.missing",
  });
  assert.equal(detail.isError, true);
  assert.match(detail.content[0].text, /package lookup failed/);
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

test("package export, preflight, import details, and import report client errors", async () => {
  const handlers = registeredPackageTools({
    getPackageDirectory: () => "/tmp/packages",
    exportPackage: async () => {
      throw new Error("export failed");
    },
    preflightPackageFile: async () => {
      throw new Error("preflight failed");
    },
    getPackageImportDetails: async () => {
      throw new Error("details failed");
    },
    importPackageWithOptions: async () => {
      throw new Error("import failed");
    },
  });

  const exported = await handlers.get("export-package")({
    name: "com.example.demo",
    fileName: "demo.package",
  });
  assert.equal(exported.isError, true);
  assert.match(exported.content[0].text, /export failed/);

  const preflight = await handlers.get("preflight-package")({
    fileName: "demo.package",
  });
  assert.equal(preflight.isError, true);
  assert.match(preflight.content[0].text, /preflight failed/);

  const details = await handlers.get("get-package-import-details")({
    fileName: "demo.package",
  });
  assert.equal(details.isError, true);
  assert.match(details.content[0].text, /details failed/);

  const imported = await handlers.get("import-package")({
    fileName: "demo.package",
    confirm: true,
  });
  assert.equal(imported.isError, true);
  assert.match(imported.content[0].text, /import failed/);
});

test("create-package requires confirmation and reports creation results", async () => {
  let created;
  const handlers = registeredPackageTools({
    createPackage: async (name, description) => {
      created = { name, description };
    },
  });

  const refused = await handlers.get("create-package")({
    name: "com.example.project",
    description: "Project package",
    confirm: false,
  });
  assert.equal(created, undefined);
  assert.match(refused.content[0].text, /Confirm creation/);

  const result = await handlers.get("create-package")({
    name: "com.example.project",
    description: "Project package",
    confirm: true,
  });
  assert.deepEqual(created, {
    name: "com.example.project",
    description: "Project package",
  });
  assert.match(result.content[0].text, /created/);
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

test("ensure-project-package reports client errors", async () => {
  const handlers = registeredPackageTools({
    ensureProjectPackage: async () => {
      throw new Error("missing package name");
    },
  });

  const result = await handlers.get("ensure-project-package")({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /missing package name/);
});

test("rebuild-project-package requires confirmation and rebuilds resolved package", async () => {
  let rebuilt;
  const handlers = registeredPackageTools({
    ensureProjectPackage: async ({ packageName }) => ({
      name: packageName,
      created: false,
    }),
    rebuildPackage: async (packageName) => {
      rebuilt = packageName;
    },
  });

  const refused = await handlers.get("rebuild-project-package")({
    packageName: "com.example.project",
    confirm: false,
  });
  assert.equal(rebuilt, undefined);
  assert.match(refused.content[0].text, /Confirm rebuild/);

  const result = await handlers.get("rebuild-project-package")({
    packageName: "com.example.project",
    confirm: true,
  });
  assert.equal(rebuilt, "com.example.project");
  assert.match(result.content[0].text, /rebuilt/);
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

test("add project package tools support actions, configurations, and resources", async () => {
  const added = [];
  const handlers = registeredPackageTools({
    ensureProjectPackage: async ({ packageName }) => ({
      name: packageName,
      created: false,
    }),
    addActionToPackage: async (packageName, categoryName, actionName) => {
      added.push(["action", packageName, categoryName, actionName]);
    },
    addConfigurationToPackage: async (packageName, configurationId) => {
      added.push(["configuration", packageName, configurationId]);
    },
    addResourceToPackage: async (packageName, resourceId) => {
      added.push(["resource", packageName, resourceId]);
    },
  });

  const actionRefused = await handlers.get("add-action-to-project-package")({
    packageName: "com.example.project",
    categoryName: "com.example.actions",
    actionName: "echo",
    confirm: false,
  });
  assert.match(actionRefused.content[0].text, /Confirm adding action/);

  await handlers.get("add-action-to-project-package")({
    packageName: "com.example.project",
    categoryName: "com.example.actions",
    actionName: "echo",
    confirm: true,
  });
  await handlers.get("add-configuration-to-project-package")({
    packageName: "com.example.project",
    configurationId: "configuration-1",
    confirm: true,
  });
  await handlers.get("add-resource-to-project-package")({
    packageName: "com.example.project",
    resourceId: "resource-1",
    confirm: true,
  });

  assert.deepEqual(added, [
    ["action", "com.example.project", "com.example.actions", "echo"],
    ["configuration", "com.example.project", "configuration-1"],
    ["resource", "com.example.project", "resource-1"],
  ]);
});

test("project package mutation tools report client errors", async () => {
  const handlers = registeredPackageTools({
    ensureProjectPackage: async () => ({
      name: "com.example.project",
      created: false,
    }),
    rebuildPackage: async () => {
      throw new Error("rebuild failed");
    },
    addWorkflowToPackage: async () => {
      throw new Error("workflow add failed");
    },
    addActionToPackage: async () => {
      throw new Error("action add failed");
    },
    addConfigurationToPackage: async () => {
      throw new Error("configuration add failed");
    },
    addResourceToPackage: async () => {
      throw new Error("resource add failed");
    },
  });

  const rebuild = await handlers.get("rebuild-project-package")({
    packageName: "com.example.project",
    confirm: true,
  });
  assert.equal(rebuild.isError, true);
  assert.match(rebuild.content[0].text, /rebuild failed/);

  const workflow = await handlers.get("add-workflow-to-project-package")({
    packageName: "com.example.project",
    workflowId: "workflow-1",
    confirm: true,
  });
  assert.equal(workflow.isError, true);
  assert.match(workflow.content[0].text, /workflow add failed/);

  const action = await handlers.get("add-action-to-project-package")({
    packageName: "com.example.project",
    categoryName: "com.example.actions",
    actionName: "echo",
    confirm: true,
  });
  assert.equal(action.isError, true);
  assert.match(action.content[0].text, /action add failed/);

  const configuration = await handlers.get("add-configuration-to-project-package")({
    packageName: "com.example.project",
    configurationId: "configuration-1",
    confirm: true,
  });
  assert.equal(configuration.isError, true);
  assert.match(configuration.content[0].text, /configuration add failed/);

  const resource = await handlers.get("add-resource-to-project-package")({
    packageName: "com.example.project",
    resourceId: "resource-1",
    confirm: true,
  });
  assert.equal(resource.isError, true);
  assert.match(resource.content[0].text, /resource add failed/);
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

test("export-project-package resolves defaults and forwards package export options", async () => {
  let exported;
  const handlers = registeredPackageTools({
    ensureProjectPackage: async ({ packageName }) => ({
      name: packageName ?? "com.example.project",
      created: false,
    }),
    exportPackage: async (name, fileName, overwrite, options) => {
      exported = { name, fileName, overwrite, options };
      return `/tmp/packages/${fileName}`;
    },
  });

  const result = await handlers.get("export-project-package")({
    packageName: "com.example.project",
    overwrite: true,
    exportConfigurationAttributeValues: true,
    exportGlobalTags: false,
    exportVersionHistory: true,
    exportConfigSecureStringAttributeValues: true,
  });

  assert.deepEqual(exported, {
    name: "com.example.project",
    fileName: "com.example.project.package",
    overwrite: true,
    options: {
      exportConfigurationAttributeValues: true,
      exportGlobalTags: false,
      exportVersionHistory: true,
      exportConfigSecureStringAttributeValues: true,
    },
  });
  assert.match(result.content[0].text, /exported successfully/);
});

test("project package import tools handle confirmation and option forwarding", async () => {
  let imported;
  const handlers = registeredPackageTools({
    resolveProjectPackageName: (packageName) => packageName ?? "com.example.project",
    getPackageImportDetails: async () => ({ packageName: "com.example.project" }),
    importPackageWithOptions: async (fileName, options) => {
      imported = { fileName, options };
    },
  });

  const refused = await handlers.get("import-project-package")({
    packageName: "com.example.project",
    confirm: false,
  });
  assert.equal(imported, undefined);
  assert.match(refused.content[0].text, /Confirm import/);

  const result = await handlers.get("import-project-package")({
    packageName: "com.example.project",
    fileName: "project.package",
    overwrite: true,
    importConfigurationAttributeValues: true,
    tagImportMode: "ImportButPreserveExistingValue",
    importConfigSecureStringAttributeValues: true,
    confirm: true,
  });

  assert.deepEqual(imported, {
    fileName: "project.package",
    options: {
      overwrite: true,
      importConfigurationAttributeValues: true,
      tagImportMode: "ImportButPreserveExistingValue",
      importConfigSecureStringAttributeValues: true,
    },
  });
  assert.match(result.content[0].text, /imported from: project\.package/);
});

test("import-project-package expected guard fails when details omit package name", async () => {
  let imported;
  const handlers = registeredPackageTools({
    resolveProjectPackageName: (packageName) => packageName ?? "com.example.project",
    getPackageImportDetails: async () => ({}),
    importPackageWithOptions: async (fileName, options) => {
      imported = { fileName, options };
    },
  });

  const result = await handlers.get("import-project-package")({
    packageName: "com.example.project",
    expectedPackageName: "com.example.project",
    confirm: true,
  });

  assert.equal(result.isError, true);
  assert.equal(imported, undefined);
  assert.match(result.content[0].text, /package name/);
  assert.match(result.content[0].text, /found \(missing\)/);
});

test("project package file tools report client errors", async () => {
  const handlers = registeredPackageTools({
    resolveProjectPackageName: () => "com.example.project",
    ensureProjectPackage: async () => ({
      name: "com.example.project",
      created: false,
    }),
    exportPackage: async () => {
      throw new Error("project export failed");
    },
    getPackageImportDetails: async () => {
      throw new Error("project details failed");
    },
  });

  const exported = await handlers.get("export-project-package")({
    packageName: "com.example.project",
  });
  assert.equal(exported.isError, true);
  assert.match(exported.content[0].text, /project export failed/);

  const details = await handlers.get("get-project-package-import-details")({
    packageName: "com.example.project",
  });
  assert.equal(details.isError, true);
  assert.match(details.content[0].text, /project details failed/);
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

test("package import and delete expected guards verify package names", async () => {
  let imported;
  let deleted;
  const handlers = registeredPackageTools({
    getPackageDirectory: () => "/tmp/packages",
    getPackageImportDetails: async () => ({
      packageName: "com.example.bundle",
    }),
    importPackageWithOptions: async (fileName, options) => {
      imported = { fileName, options };
    },
    getPackage: async (name) => ({ name }),
    deletePackage: async (name, deleteContents) => {
      deleted = { name, deleteContents };
    },
  });

  const importMismatch = await handlers.get("import-package")({
    fileName: "bundle.package",
    expectedPackageName: "com.example.other",
    confirm: true,
  });
  assert.equal(importMismatch.isError, true);
  assert.equal(imported, undefined);

  await handlers.get("import-package")({
    fileName: "bundle.package",
    expectedPackageName: "com.example.bundle",
    overwrite: false,
    confirm: true,
  });
  assert.deepEqual(imported, {
    fileName: "bundle.package",
    options: {
      overwrite: false,
      importConfigurationAttributeValues: undefined,
      tagImportMode: undefined,
      importConfigSecureStringAttributeValues: undefined,
    },
  });

  const deleteMismatch = await handlers.get("delete-package")({
    name: "com.example.bundle",
    expectedName: "com.example.other",
    confirm: true,
  });
  assert.equal(deleteMismatch.isError, true);
  assert.equal(deleted, undefined);
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

test("export-package and export-project-package are not read-only", () => {
  const { configs } = registeredPackageToolsWithConfigs({});

  assert.equal(configs.get("export-package").annotations.readOnlyHint, false);
  assert.equal(configs.get("export-project-package").annotations.readOnlyHint, false);
});
