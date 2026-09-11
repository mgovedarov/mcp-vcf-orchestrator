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
import { registerProjectTools } from "../dist/tools/project-tools.js";
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
  "update-action",
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
function registerAllToolConfigs(client = {}) {
  const configs = new Map();
  const server = {
    registerTool(name, config, handler) {
      assert.equal(configs.has(name), false, `duplicate tool name: ${name}`);
      configs.set(name, { ...config, handler });
    },
    sendResourceListChanged() {},
  };
  registerWorkflowTools(server, client);
  registerActionTools(server, client);
  registerConfigTools(server, client);
  registerCategoryTools(server, client);
  registerSubscriptionTools(server, client);
  registerCatalogTools(server, client);
  registerProjectTools(server, client);
  registerDeploymentTools(server, client);
  registerTemplateTools(server, client);
  registerPackageTools(server, client);
  registerPromotionTools(server, client);
  registerContextTools(server, client);
  registerResourceTools(server, client);
  registerPluginTools(server, client);
  return configs;
}

const flatLists = [
  ["list-workflows", "listWorkflows", { filter: "sample" }, ["sample"], "workflow(s)", "• sample (id: item)"],
  ["list-actions", "listActions", { filter: "sample" }, ["sample"], "action(s)", "• module/sample (id: item)"],
  ["list-configurations", "listConfigurations", { filter: "sample", categoryId: "cat" }, ["sample", "cat"], "configuration element(s)", "• sample (id: item)"],
  ["list-categories", "listCategories", { type: "WorkflowCategory", filter: "sample" }, ["WorkflowCategory", "sample"], "WorkflowCategory category(ies)", "• sample (id: item)"],
  ["list-resource-elements", "listResources", { filter: "sample" }, ["sample"], "resource element(s)", "• sample (id: item)"],
  ["list-packages", "listPackages", { filter: "sample" }, ["sample"], "package(s)", "• sample"],
  ["list-plugins", "listPlugins", { filter: "sample" }, ["sample"], "plugin(s)", "• sample"],
  ["list-catalog-items", "listCatalogItems", { search: "sample" }, ["sample"], "catalog item(s)", "• sample (id: item)", true],
  ["list-projects", "listProjects", { search: "sample" }, ["sample"], "project(s)", "• sample (id: item)", true],
  ["list-deployments", "listDeployments", { search: "sample", projectId: "project" }, ["sample", "project"], "deployment(s)", "• sample (id: item)", true],
  ["list-templates", "listTemplates", { search: "sample", projectId: "project" }, ["sample", "project"], "template(s)", "• sample (id: item)", true],
  ["list-event-topics", "listEventTopics", {}, [], "event topic(s)", "• sample (id: item)"],
  ["list-subscriptions", "listSubscriptions", { projectId: "project" }, ["project"], "subscription(s)", "• sample (id: item) — topic: N/A, runnable: N/A/N/A, ENABLED"],
];

for (const [name, method, selectors, positional, label, row, totalHeading] of flatLists) {
  test(`${name}: limit schema is optional, bounded, and describes filters`, () => {
    const config = registerAllToolConfigs().get(name);
    assert.equal(config.annotations.readOnlyHint, true);
    assert.deepEqual(config.inputSchema.parse(selectors), selectors);
    for (const limit of [1, 1000]) {
      assert.equal(config.inputSchema.parse({ ...selectors, limit }).limit, limit);
    }
    for (const limit of [0, 1001, 1.5, "2", null]) {
      assert.equal(config.inputSchema.safeParse({ ...selectors, limit }).success, false);
    }
    assert.match(config.inputSchema.shape.limit.description, /after.*filter\/search/);
  });

  test(`${name}: forwards limit and renders known, unknown, capped and complete results`, async () => {
    let received;
    const items = [{ id: "item", name: "sample", ...(method === "listActions" ? { module: "module" } : {}) }];
    let page = { link: items, content: items, total: 10, totalElements: 10 };
    const tool = registerAllToolConfigs({ [method]: async (...args) => {
      received = args;
      return page;
    } }).get(name);

    const original = await tool.handler(selectors);
    assert.equal(original.content[0].text, `Found ${totalHeading ? 10 : 1} ${label}:\n\n${row}`);
    assert.equal(original.isError, undefined);
    if (method === "listWorkflows") {
      assert.deepEqual(original.structuredContent, { workflows: items });
    } else {
      assert.equal(original.structuredContent, undefined);
    }

    page = { ...page, limited: true };
    const known = await tool.handler({ ...selectors, limit: 1 });
    assert.deepEqual(received, [...positional, { limit: 1 }]);
    assert.match(known.content[0].text, /^Found 1 /);
    assert.match(known.content[0].text, /showing the first 1 of 10/);
    assert.doesNotMatch(known.content[0].text, /Results truncated/);
    if (method === "listWorkflows") assert.equal(known.structuredContent.limited, true);

    delete page.total;
    delete page.totalElements;
    const unknown = await tool.handler({ ...selectors, limit: 1 });
    assert.match(unknown.content[0].text, /showing the first 1 item/);
    assert.doesNotMatch(unknown.content[0].text, / of /);

    page.truncated = true;
    const both = await tool.handler({ ...selectors, limit: 1 });
    assert.match(both.content[0].text, /Results truncated/);
    assert.match(both.content[0].text, /Results limited/);

    page = { link: [], content: [], truncated: true };
    const empty = await tool.handler({ ...selectors, limit: 1 });
    assert.match(empty.content[0].text, /^No /);
    assert.match(empty.content[0].text, /Results truncated/);
    assert.doesNotMatch(empty.content[0].text, /Results limited/);
  });
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
