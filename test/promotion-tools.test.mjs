import assert from "node:assert/strict";
import test from "node:test";
import { VroClient } from "../dist/vro-client.js";
import { registerPromotionTools } from "../dist/tools/promotion-tools.js";

const config = (overrides = {}) => ({
  host: "vcfa.example.test",
  username: "admin",
  organization: "org",
  password: "secret",
  ...overrides,
});

function validReport(kind, fileName, metadata = {}) {
  return {
    kind,
    fileName,
    valid: true,
    errors: [],
    warnings: ["Review target ownership before import"],
    metadata,
    entries: [{ name: "artifact.xml", size: 100 }],
    parameters: [{ name: "message", type: "string", scope: "input" }],
    actionReferences: [
      {
        module: "com.example.actions",
        action: "echo",
        expression: 'System.getModule("com.example.actions").echo(',
      },
    ],
  };
}

function invalidReport(kind, fileName) {
  return {
    kind,
    fileName,
    valid: false,
    errors: ["Artifact is not a valid ZIP archive"],
    warnings: [],
    metadata: {},
    entries: [],
    parameters: [],
    actionReferences: [],
  };
}

function registeredPromotionTools(client) {
  const handlers = new Map();
  const configs = new Map();
  const server = {
    registerTool(name, config, handler) {
      configs.set(name, config);
      handlers.set(name, handler);
    },
  };
  registerPromotionTools(server, client);
  return { handlers, configs };
}

test("prepareArtifactPromotion prepares workflow promotion with diff and generated backup", async () => {
  const client = new VroClient(config());
  let backupFileName;
  client.preflightWorkflowFile = async (fileName) =>
    validReport("workflow", fileName, { name: "Provision" });
  client.diffWorkflowFile = async (params) => {
    assert.deepEqual(params, {
      base: { source: "live", workflowId: "workflow-1" },
      compare: { source: "file", fileName: "provision.workflow" },
    });
    return "Workflow item changes:\n• Changed task item1: script changed (1 line(s), sha256:old -> 1 line(s), sha256:new)";
  };
  client.exportWorkflowFile = async (id, fileName, overwrite) => {
    assert.equal(id, "workflow-1");
    assert.equal(overwrite, false);
    backupFileName = fileName;
    return `/tmp/workflows/${fileName}`;
  };

  const text = await client.prepareArtifactPromotion({
    kind: "workflow",
    fileName: "provision.workflow",
    target: { workflowId: "workflow-1", categoryId: "category-1" },
    backup: { enabled: true },
  });

  assert.match(backupFileName, /^provision\.backup-[0-9A-Za-z]+\.workflow$/);
  assert.match(text, /Workflow artifact preflight passed/);
  assert.match(text, /Live comparison/);
  assert.match(text, /Workflow item changes/);
  assert.match(text, /Backup exported: \/tmp\/workflows\//);
  assert.match(
    text,
    /import-workflow-file\({ categoryId: "category-1", fileName: "provision.workflow", overwrite: true, confirm: true }\)/,
  );
});

test("prepareArtifactPromotion prepares action promotion with diff", async () => {
  const client = new VroClient(config());
  client.preflightActionFile = async (fileName) =>
    validReport("action", fileName, { name: "echo", module: "com.example" });
  client.diffActionFile = async (params) => {
    assert.deepEqual(params, {
      base: { source: "live", actionId: "action-1" },
      compare: { source: "file", fileName: "echo.action" },
    });
    return "Script changes:\n• script changed (1 line(s), sha256:old -> 2 line(s), sha256:new)";
  };

  const text = await client.prepareArtifactPromotion({
    kind: "action",
    fileName: "echo.action",
    target: { actionId: "action-1", categoryName: "com.example" },
  });

  assert.match(text, /Action artifact preflight passed/);
  assert.match(text, /Script changes/);
  assert.match(
    text,
    /import-action-file\({ categoryName: "com.example", fileName: "echo.action", confirm: true }\)/,
  );
});

test("prepareArtifactPromotion prepares configuration promotion summary", async () => {
  const client = new VroClient(config());
  client.preflightConfigurationFile = async (fileName) =>
    validReport("configuration", fileName, { name: "Settings", version: "1.0.0" });

  const text = await client.prepareArtifactPromotion({
    kind: "configuration",
    fileName: "settings.vsoconf",
    target: { categoryId: "config-category" },
  });

  assert.match(text, /Configuration artifact preflight passed/);
  assert.match(text, /Metadata/);
  assert.match(text, /Parameters/);
  assert.match(text, /Action References/);
  assert.match(
    text,
    /import-configuration-file\({ categoryId: "config-category", fileName: "settings.vsoconf", confirm: true }\)/,
  );
});

test("prepareArtifactPromotion prepares package promotion summary", async () => {
  const client = new VroClient(config());
  client.preflightPackageFile = async (fileName) =>
    validReport("package", fileName, {
      workflowArtifacts: 2,
      actionArtifacts: 3,
      configurationArtifacts: 1,
    });

  const text = await client.prepareArtifactPromotion({
    kind: "package",
    fileName: "bundle.package",
    overwrite: false,
  });

  assert.match(text, /Package artifact preflight passed/);
  assert.match(text, /workflowArtifacts: 2/);
  assert.match(text, /actionArtifacts: 3/);
  assert.match(text, /configurationArtifacts: 1/);
  assert.match(
    text,
    /import-package\({ fileName: "bundle.package", overwrite: false, confirm: true }\)/,
  );
});

test("prepareArtifactPromotion blocks backup and import recommendation on failed preflight", async () => {
  const client = new VroClient(config());
  let exported = false;
  client.preflightActionFile = async (fileName) =>
    invalidReport("action", fileName);
  client.exportActionFile = async () => {
    exported = true;
  };

  const text = await client.prepareArtifactPromotion({
    kind: "action",
    fileName: "bad.action",
    target: { actionId: "action-1", categoryName: "com.example" },
    backup: { enabled: true },
  });

  assert.equal(exported, false);
  assert.match(text, /Blocking errors/);
  assert.match(text, /Backup skipped because preflight failed/);
  assert.match(text, /Ready import call: unavailable until preflight passes/);
  assert.doesNotMatch(text, /import-action-file\(/);
});

test("prepareArtifactPromotion reports missing backup target but still recommends complete import", async () => {
  const client = new VroClient(config());
  client.preflightPackageFile = async (fileName) =>
    validReport("package", fileName);

  const text = await client.prepareArtifactPromotion({
    kind: "package",
    fileName: "bundle.package",
    backup: { enabled: true },
  });

  assert.match(text, /Backup skipped: packageName is required/);
  assert.match(text, /import-package\(/);
});

test("prepareArtifactPromotion reports incomplete import targets", async () => {
  const client = new VroClient(config());
  client.preflightWorkflowFile = async (fileName) =>
    validReport("workflow", fileName);

  const text = await client.prepareArtifactPromotion({
    kind: "workflow",
    fileName: "provision.workflow",
  });

  assert.match(text, /target.categoryId is required/);
  assert.doesNotMatch(text, /import-workflow-file\({/);
});

test("prepare-artifact-promotion tool is registered, delegates params, and reports errors", async () => {
  let promotionParams;
  const { handlers, configs } = registeredPromotionTools({
    prepareArtifactPromotion: async (params) => {
      promotionParams = params;
      return "prepared";
    },
  });

  assert.equal(
    configs.get("prepare-artifact-promotion").annotations.readOnlyHint,
    false,
  );

  const input = {
    kind: "workflow",
    fileName: "provision.workflow",
    target: { workflowId: "workflow-1", categoryId: "category-1" },
    overwrite: true,
    backup: { enabled: true, fileName: "backup.workflow" },
  };
  const result = await handlers.get("prepare-artifact-promotion")(input);
  assert.deepEqual(promotionParams, input);
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].text, "prepared");

  const failing = registeredPromotionTools({
    prepareArtifactPromotion: async () => {
      throw new Error("boom");
    },
  });
  const errorResult = await failing.handlers.get("prepare-artifact-promotion")(
    input,
  );
  assert.equal(errorResult.isError, true);
  assert.match(
    errorResult.content[0].text,
    /Failed to prepare artifact promotion: boom/,
  );
});
