import assert from "node:assert/strict";
import test from "node:test";
import { registerActionTools } from "../dist/tools/action-tools.js";
import { registerConfigTools } from "../dist/tools/config-tools.js";
import { registerResourceTools } from "../dist/tools/resource-tools.js";

function registeredTools(register, client) {
  const handlers = new Map();
  const server = {
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
  };
  register(server, client);
  return handlers;
}

function registeredToolsWithConfigs(register, client) {
  const handlers = new Map();
  const configs = new Map();
  const server = {
    registerTool(name, config, handler) {
      configs.set(name, config);
      handlers.set(name, handler);
    },
  };
  register(server, client);
  return { handlers, configs };
}

test("action tools format detail responses and pass create payloads", async () => {
  let createParams;
  const handlers = registeredTools(registerActionTools, {
    getAction: async (id) => ({
      id,
      name: "getVmIp",
      module: "com.example.actions",
      description: "Read IP address",
      version: "1.0.0",
      fqn: "com.example.actions.getVmIp",
      "output-type": "string",
      "input-parameters": [
        { name: "vm", type: "VC:VirtualMachine", description: "VM" },
      ],
      script: "return vm.ipAddress;",
    }),
    createAction: async (params) => {
      createParams = params;
      return {
        id: "action-1",
        name: params.name,
        module: params.moduleName,
      };
    },
  });

  const detail = await handlers.get("get-action")({ id: "action-1" });
  assert.match(detail.content[0].text, /Action: getVmIp/);
  assert.match(detail.content[0].text, /Return type: string/);
  assert.match(detail.content[0].text, /```javascript\nreturn vm\.ipAddress;/);

  const created = await handlers.get("create-action")({
    moduleName: "com.example.actions",
    name: "getVmIp",
    script: "return vm.ipAddress;",
    inputParameters: [{ name: "vm", type: "VC:VirtualMachine" }],
    returnType: "string",
  });
  assert.deepEqual(createParams, {
    moduleName: "com.example.actions",
    name: "getVmIp",
    script: "return vm.ipAddress;",
    inputParameters: [{ name: "vm", type: "VC:VirtualMachine" }],
    returnType: "string",
  });
  assert.match(created.content[0].text, /ID: action-1/);
});

test("configuration tools format attributes and guard imports and deletes", async () => {
  let imported;
  let deletedId;
  const handlers = registeredTools(registerConfigTools, {
    getConfiguration: async (id) => ({
      id,
      name: "Settings",
      version: "1.0.0",
      attributes: [
        {
          name: "host",
          type: "string",
          value: { string: { value: "vcfa.example.test" } },
          description: "Host name",
        },
      ],
    }),
    getConfigurationDirectory: () => "/tmp/configurations",
    importConfigurationFile: async (categoryId, fileName) => {
      imported = { categoryId, fileName };
    },
    deleteConfiguration: async (id) => {
      deletedId = id;
    },
  });

  const detail = await handlers.get("get-configuration")({ id: "config-1" });
  assert.match(detail.content[0].text, /Configuration: Settings/);
  assert.match(detail.content[0].text, /host \(string\):/);
  assert.match(detail.content[0].text, /Host name/);

  const importRefused = await handlers.get("import-configuration-file")({
    categoryId: "category-1",
    fileName: "settings.vsoconf",
    confirm: false,
  });
  assert.equal(imported, undefined);
  assert.match(importRefused.content[0].text, /\/tmp\/configurations/);

  await handlers.get("import-configuration-file")({
    categoryId: "category-1",
    fileName: "settings.vsoconf",
    confirm: true,
  });
  assert.deepEqual(imported, {
    categoryId: "category-1",
    fileName: "settings.vsoconf",
  });

  const deleteRefused = await handlers.get("delete-configuration")({
    id: "config-1",
    confirm: false,
  });
  assert.equal(deletedId, undefined);
  assert.match(deleteRefused.content[0].text, /setting confirm to true/);

  await handlers.get("delete-configuration")({
    id: "config-1",
    confirm: true,
  });
  assert.equal(deletedId, "config-1");
});

test("action and configuration preflight tools format reports and are read-only", async () => {
  const action = registeredToolsWithConfigs(registerActionTools, {
    preflightActionFile: async (fileName) => ({
      kind: "action",
      fileName,
      valid: true,
      errors: [],
      warnings: ["No parseable XML entries were recognized"],
      metadata: { name: "getVmIp" },
      entries: [{ name: "action.xml", size: 100 }],
      parameters: [],
      actionReferences: [],
    }),
  });
  assert.equal(
    action.configs.get("preflight-action-file").annotations.readOnlyHint,
    true,
  );
  const actionResult = await action.handlers.get("preflight-action-file")({
    fileName: "getVmIp.action",
  });
  assert.equal(actionResult.isError, false);
  assert.match(actionResult.content[0].text, /preflight passed/);
  assert.match(actionResult.content[0].text, /getVmIp/);

  const config = registeredToolsWithConfigs(registerConfigTools, {
    preflightConfigurationFile: async (fileName) => ({
      kind: "configuration",
      fileName,
      valid: false,
      errors: ["Artifact is not a valid ZIP archive"],
      warnings: [],
      metadata: {},
      entries: [],
      parameters: [],
      actionReferences: [],
    }),
  });
  assert.equal(
    config.configs.get("preflight-configuration-file").annotations
      .readOnlyHint,
    true,
  );
  const configResult = await config.handlers.get(
    "preflight-configuration-file",
  )({
    fileName: "settings.vsoconf",
  });
  assert.equal(configResult.isError, true);
  assert.match(configResult.content[0].text, /valid ZIP archive/);
});

test("resource tools format lists and guard updates and deletes", async () => {
  let updated;
  let deleted;
  const handlers = registeredTools(registerResourceTools, {
    listResources: async (filter) => ({
      link: [
        {
          id: "resource-1",
          name: `Logo ${filter}`,
          mimeType: "image/png",
          categoryName: "Branding",
          description: "Portal logo",
        },
      ],
    }),
    updateResourceContent: async (id, fileName, changesetSha) => {
      updated = { id, fileName, changesetSha };
    },
    deleteResource: async (id, force) => {
      deleted = { id, force };
    },
  });

  const list = await handlers.get("list-resource-elements")({
    filter: "portal",
  });
  assert.match(
    list.content[0].text,
    /Logo portal \(id: resource-1\) \[image\/png\]/,
  );
  assert.match(list.content[0].text, /category: Branding/);

  const updateRefused = await handlers.get("update-resource-element")({
    id: "resource-1",
    fileName: "logo.png",
    changesetSha: "abc123",
    confirm: false,
  });
  assert.equal(updated, undefined);
  assert.match(updateRefused.content[0].text, /Confirm update/);

  await handlers.get("update-resource-element")({
    id: "resource-1",
    fileName: "logo.png",
    changesetSha: "abc123",
    confirm: true,
  });
  assert.deepEqual(updated, {
    id: "resource-1",
    fileName: "logo.png",
    changesetSha: "abc123",
  });

  await handlers.get("delete-resource-element")({
    id: "resource-1",
    force: true,
    confirm: true,
  });
  assert.deepEqual(deleted, { id: "resource-1", force: true });
});
