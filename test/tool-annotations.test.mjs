import assert from "node:assert/strict";
import test from "node:test";
import { registerActionTools } from "../dist/tools/action-tools.js";
import { registerCatalogTools } from "../dist/tools/catalog-tools.js";
import { registerCategoryTools } from "../dist/tools/category-tools.js";
import { registerConfigTools } from "../dist/tools/config-tools.js";
import { registerContextTools } from "../dist/tools/context-tools.js";
import { registerDeploymentTools } from "../dist/tools/deployment-tools.js";
import { registerPackageTools } from "../dist/tools/package-tools.js";
import { registerPluginTools } from "../dist/tools/plugin-tools.js";
import { registerPromotionTools } from "../dist/tools/promotion-tools.js";
import { registerResourceTools } from "../dist/tools/resource-tools.js";
import { registerSubscriptionTools } from "../dist/tools/subscription-tools.js";
import { registerTemplateTools } from "../dist/tools/template-tools.js";
import { registerWorkflowTools } from "../dist/tools/workflow-tools.js";

// Every tool that overwrites or deletes live VCFA/vRO state must advertise
// destructiveHint: true so MCP hosts can gate elevated approval (VCFO-051).
// Additive live writes (create-*, ensure-*, add-*-to-project-package) and
// local-only artifact writes (export-*, scaffold-*, snapshot/promotion tools)
// are deliberately excluded.
const DESTRUCTIVE_TOOLS = new Set([
  "delete-action",
  "delete-configuration",
  "delete-deployment",
  "delete-package",
  "delete-resource-element",
  "delete-subscription",
  "delete-template",
  "delete-workflow",
  "import-action-file",
  "import-configuration-file",
  "import-package",
  "import-project-package",
  "import-resource-element",
  "import-workflow-file",
  "rebuild-project-package",
  "run-deployment-action",
  "run-workflow",
  "run-workflow-and-wait",
  "update-configuration",
  "update-resource-element",
  "update-subscription",
]);

// Name prefixes that signal a live overwrite/delete/execute; any newly added
// tool matching these must be listed in DESTRUCTIVE_TOOLS (and annotated) or
// this test fails, keeping annotations from drifting again.
const DESTRUCTIVE_NAME_PATTERN = /^(import-|delete-|update-|run-)/;

// Registers every tool module; keep the call list in sync with the
// register* calls in src/index.ts so no module escapes these checks.
function registerAllToolConfigs() {
  const configs = new Map();
  const server = {
    registerTool(name, config) {
      assert.equal(configs.has(name), false, `duplicate tool name: ${name}`);
      configs.set(name, config);
    },
    sendResourceListChanged() {},
  };
  const client = {};
  registerWorkflowTools(server, client);
  registerActionTools(server, client);
  registerConfigTools(server, client);
  registerCategoryTools(server, client);
  registerSubscriptionTools(server, client);
  registerCatalogTools(server, client);
  registerDeploymentTools(server, client);
  registerTemplateTools(server, client);
  registerPackageTools(server, client);
  registerPromotionTools(server, client);
  registerContextTools(server, client);
  registerResourceTools(server, client);
  registerPluginTools(server, client);
  return configs;
}

test("every registered tool declares a boolean readOnlyHint annotation", () => {
  const configs = registerAllToolConfigs();
  assert.ok(configs.size > 0);
  for (const [name, config] of configs) {
    assert.equal(
      typeof config.annotations?.readOnlyHint,
      "boolean",
      `${name} must declare annotations.readOnlyHint`,
    );
  }
});

test("all tools that overwrite or delete live state set destructiveHint: true", () => {
  const configs = registerAllToolConfigs();
  for (const name of DESTRUCTIVE_TOOLS) {
    const config = configs.get(name);
    assert.ok(config, `expected destructive tool to be registered: ${name}`);
    assert.equal(
      config.annotations?.readOnlyHint,
      false,
      `${name} must set readOnlyHint: false`,
    );
    assert.equal(
      config.annotations?.destructiveHint,
      true,
      `${name} must set destructiveHint: true`,
    );
  }
});

test("tools with destructive name prefixes are tracked as destructive", () => {
  const configs = registerAllToolConfigs();
  for (const name of configs.keys()) {
    if (DESTRUCTIVE_NAME_PATTERN.test(name)) {
      assert.ok(
        DESTRUCTIVE_TOOLS.has(name),
        `${name} matches a destructive name prefix; add destructiveHint: true and list it in DESTRUCTIVE_TOOLS`,
      );
    }
  }
});

test("read-only tools never carry destructiveHint: true", () => {
  const configs = registerAllToolConfigs();
  for (const [name, config] of configs) {
    if (config.annotations?.readOnlyHint === true) {
      assert.notEqual(
        config.annotations?.destructiveHint,
        true,
        `${name} is read-only and must not set destructiveHint: true`,
      );
    }
  }
});
