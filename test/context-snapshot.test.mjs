import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectContextSnapshot } from "../dist/client/context-snapshot.js";
import { registerContextTools } from "../dist/tools/context-tools.js";

function baseClient(contextDir) {
  return {
    getContextDirectory: () => contextDir,
    listWorkflows: async () => ({
      link: [
        { id: "workflow-2", name: "Z Workflow" },
        { id: "workflow-1", name: "A Workflow" },
      ],
    }),
    getWorkflow: async (id) => ({
      id,
      name: id === "workflow-1" ? "A Workflow" : "Z Workflow",
      description: "Workflow description",
      version: "1.0.0",
      categoryName: "VCFA",
      inputParameters: [{ name: "projectName", type: "string" }],
      outputParameters: [{ name: "vmNames", type: "Array/string" }],
    }),
    listActions: async () => ({
      link: [
        {
          id: "action-1",
          name: "getVmIp",
          module: "com.example",
          fqn: "com.example.getVmIp",
        },
      ],
    }),
    getAction: async (id) => ({
      id,
      name: "getVmIp",
      module: "com.example",
      fqn: "com.example.getVmIp",
      "input-parameters": [{ name: "vm", type: "VC:VirtualMachine" }],
      "output-type": "string",
      script: "return vm.ipAddress;",
    }),
    listConfigurations: async () => ({
      link: [{ id: "config-1", name: "Settings" }],
    }),
    getConfiguration: async (id) => ({
      id,
      name: "Settings",
      attributes: [
        {
          name: "apiToken",
          type: "SecureString",
          value: { string: { value: "secret-token" } },
          description: "Token",
        },
      ],
    }),
    listResources: async () => ({
      link: [{ id: "resource-1", name: "logo", mimeType: "image/png" }],
    }),
    listCategories: async (categoryType) => ({
      link: [
        {
          id: `${categoryType}-1`,
          name: categoryType,
          type: categoryType,
          path: `/${categoryType}`,
        },
      ],
    }),
    listTemplates: async () => ({ content: [{ id: "template-1", name: "Ubuntu" }] }),
    getTemplate: async (id) => ({
      id,
      name: "Ubuntu",
      content: "formatVersion: 1\nresources: {}",
      projectId: "project-1",
    }),
    listCatalogItems: async () => ({
      content: [{ id: "catalog-1", name: "Small VM" }],
    }),
    getCatalogItem: async (id) => ({ id, name: "Small VM", sourceName: "Ubuntu" }),
    listEventTopics: async () => ({
      content: [{ id: "topic-1", name: "Deployment requested", schema: { secret: "shape" } }],
    }),
    listSubscriptions: async () => ({
      content: [{ id: "sub-1", name: "Tag VM", runnableId: "workflow-1" }],
    }),
    listPackages: async () => ({ link: [{ name: "com.example.package" }] }),
    getPackage: async (name) => ({ name, version: "1.0.0" }),
    listPlugins: async () => ({ link: [{ name: "vra", version: "1.0.0" }] }),
  };
}

test("collectContextSnapshot writes deterministic JSON and Markdown with redaction", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-"));
  try {
    const result = await collectContextSnapshot(baseClient(contextDir), {
      fileBaseName: "snapshot",
      overwrite: true,
    });

    assert.equal(result.counts.workflows, 2);
    assert.equal(result.skipped.workflows, 0);
    const json = JSON.parse(await readFile(result.jsonPath, "utf8"));
    const markdown = await readFile(result.markdownPath, "utf8");

    assert.deepEqual(json.domains, [
      "actions",
      "categories",
      "configurations",
      "resources",
      "workflows",
    ]);
    assert.equal(json.data.workflows[0].name, "A Workflow");
    assert.equal(json.data.actions[0].script.included, false);
    assert.equal(json.data.actions[0].script.length, "return vm.ipAddress;".length);
    assert.match(json.data.actions[0].script.sha256, /^[0-9a-f]{64}$/);
    assert.equal(json.data.configurations[0].attributes[0].value.redacted, true);
    assert.doesNotMatch(JSON.stringify(json), /secret-token/);
    assert.match(markdown, /# VCFA Context Snapshot/);
    assert.match(markdown, /A Workflow/);
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
});

test("collectContextSnapshot bounds domains and records skipped counts", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-"));
  try {
    const result = await collectContextSnapshot(baseClient(contextDir), {
      fileBaseName: "limited",
      domains: ["workflows"],
      maxItemsPerDomain: 1,
    });
    const json = JSON.parse(await readFile(result.jsonPath, "utf8"));
    assert.equal(result.counts.workflows, 1);
    assert.equal(result.skipped.workflows, 1);
    assert.equal(json.data.workflows.length, 1);
    assert.equal(json.data.workflows[0].name, "A Workflow");
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
});

test("collectContextSnapshot includes optional domains when requested", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-"));
  try {
    const result = await collectContextSnapshot(baseClient(contextDir), {
      fileBaseName: "optional",
      domains: ["workflows"],
      includeOptionalDomains: true,
    });
    const json = JSON.parse(await readFile(result.jsonPath, "utf8"));
    assert.equal(result.counts.templates, 1);
    assert.equal(json.data.templates[0].content.included, false);
    assert.match(json.data.templates[0].content.sha256, /^[0-9a-f]{64}$/);
    assert.equal(result.counts.catalogItems, 1);
    assert.equal(result.counts.plugins, 1);
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
});

test("collectContextSnapshot rejects unsafe names and existing files", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-"));
  try {
    await assert.rejects(
      collectContextSnapshot(baseClient(contextDir), {
        fileBaseName: "../bad",
      }),
      /path separators|absolute|escapes/,
    );
    await assert.rejects(
      collectContextSnapshot(baseClient(contextDir), {
        fileBaseName: "snapshot.json",
      }),
      /must not include an extension/,
    );

    await writeFile(join(contextDir, "exists.json"), "{}");
    await writeFile(join(contextDir, "exists.md"), "# existing");
    await assert.rejects(
      collectContextSnapshot(baseClient(contextDir), {
        fileBaseName: "exists",
      }),
      /already exists/,
    );
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
});

test("collect-context-snapshot tool delegates and reports saved paths", async () => {
  let received;
  const handlers = new Map();
  const configs = new Map();
  const server = {
    registerTool(name, config, handler) {
      configs.set(name, config);
      handlers.set(name, handler);
    },
  };
  registerContextTools(server, {
    collectContextSnapshot: async (params) => {
      received = params;
      return {
        jsonPath: "/tmp/context/vcfa-context.json",
        markdownPath: "/tmp/context/vcfa-context.md",
        counts: { workflows: 1 },
        skipped: { workflows: 0 },
        warnings: [],
      };
    },
  });

  assert.equal(configs.get("collect-context-snapshot").annotations.readOnlyHint, true);
  const result = await handlers.get("collect-context-snapshot")({
    domains: ["workflows"],
  });
  assert.deepEqual(received, { domains: ["workflows"] });
  assert.match(result.content[0].text, /vcfa-context\.json/);
});
