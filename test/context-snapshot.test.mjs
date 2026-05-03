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

test("collectContextSnapshot vcfaBuiltIns profile filters Library subfolder workflows and VMware actions", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-"));
  try {
    const client = {
      ...baseClient(contextDir),
      listCategories: async (categoryType) => {
        if (categoryType === "WorkflowCategory") {
          return {
            link: [
              {
                id: "library-root",
                name: "Library",
                type: "WorkflowCategory",
                path: "/Library",
              },
              {
                id: "library-vc",
                name: "vCenter",
                type: "WorkflowCategory",
                path: "/Library/vCenter",
              },
              {
                id: "custom",
                name: "Custom",
                type: "WorkflowCategory",
                path: "/Custom",
              },
            ],
          };
        }
        return { link: [] };
      },
      listWorkflows: async () => ({
        link: [
          {
            id: "wf-library",
            name: "Library Root Workflow",
            categoryId: "library-root",
            categoryName: "Library",
          },
          {
            id: "wf-library-child",
            name: "Library Child Workflow",
            categoryId: "library-vc",
            categoryName: "vCenter",
          },
          {
            id: "wf-custom",
            name: "Custom Workflow",
            categoryId: "custom",
            categoryName: "Custom",
          },
        ],
      }),
      getWorkflow: async (id) => ({
        id,
        name:
          id === "wf-library-child"
            ? "Library Child Workflow"
            : "Library Root Workflow",
        categoryId: id === "wf-library-child" ? "library-vc" : "library-root",
        categoryName: id === "wf-library-child" ? "vCenter" : "Library",
        inputParameters: [],
        outputParameters: [],
      }),
      listActions: async () => ({
        link: [
          {
            id: "action-vmware-root",
            name: "vmwareRoot",
            module: "com.vmware",
            fqn: "com.vmware.vmwareRoot",
          },
          {
            id: "action-vmware-child",
            name: "vmwareChild",
            module: "com.vmware.library",
            fqn: "com.vmware.library.vmwareChild",
          },
          {
            id: "action-custom",
            name: "custom",
            module: "com.example",
            fqn: "com.example.custom",
          },
        ],
      }),
      getAction: async (id) => ({
        id,
        name: id === "action-vmware-root" ? "vmwareRoot" : "vmwareChild",
        module:
          id === "action-vmware-root" ? "com.vmware" : "com.vmware.library",
        fqn:
          id === "action-vmware-root"
            ? "com.vmware.vmwareRoot"
            : "com.vmware.library.vmwareChild",
        "input-parameters": [],
        "output-type": "void",
        script: "// built-in",
      }),
    };

    const result = await collectContextSnapshot(client, {
      profile: "vcfaBuiltIns",
      overwrite: true,
    });
    const json = JSON.parse(await readFile(result.jsonPath, "utf8"));
    const markdown = await readFile(result.markdownPath, "utf8");

    assert.equal(json.profile, "vcfaBuiltIns");
    assert.deepEqual(json.domains, ["actions", "workflows"]);
    assert.equal(json.limits.maxItemsPerDomain, 1000);
    assert.match(result.jsonPath, /vcfa-builtins-context\.json$/);
    assert.deepEqual(
      json.data.workflows.map((workflow) => workflow.id),
      ["wf-library-child"],
    );
    assert.deepEqual(
      json.data.actions.map((action) => action.id),
      ["action-vmware-child", "action-vmware-root"],
    );
    assert.equal(result.counts.workflows, 1);
    assert.equal(result.skipped.workflows, 0);
    assert.equal(result.counts.actions, 2);
    assert.equal(result.skipped.actions, 0);
    assert.match(markdown, /Profile: vcfaBuiltIns/);
    assert.match(markdown, /WorkflowCategory paths below Library/);
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
});

test("collectContextSnapshot vcfaBuiltIns profile warns when Library subfolders cannot be identified", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-"));
  try {
    const client = {
      ...baseClient(contextDir),
      listCategories: async (categoryType) => {
        if (categoryType === "WorkflowCategory") {
          return {
            link: [
              { id: "library-root", name: "Library", type: "WorkflowCategory" },
              { id: "library-child", name: "vCenter", type: "WorkflowCategory" },
            ],
          };
        }
        return { link: [] };
      },
      listWorkflows: async () => ({
        link: [
          {
            id: "wf-library-child",
            name: "Library Child Workflow",
            categoryId: "library-child",
            categoryName: "vCenter",
          },
        ],
      }),
    };

    const result = await collectContextSnapshot(client, {
      fileBaseName: "builtins-missing-paths",
      profile: "vcfaBuiltIns",
    });
    const json = JSON.parse(await readFile(result.jsonPath, "utf8"));

    assert.equal(result.counts.workflows, 0);
    assert.deepEqual(json.data.workflows, []);
    assert.match(
      result.warnings.join("\n"),
      /no Library descendant WorkflowCategory paths were found/,
    );
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
});

test("collectContextSnapshot vcfaBuiltIns profile leaves explicitly requested non-core domains unfiltered", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-"));
  try {
    const result = await collectContextSnapshot(baseClient(contextDir), {
      fileBaseName: "builtins-explicit",
      profile: "vcfaBuiltIns",
      domains: ["templates"],
    });
    const json = JSON.parse(await readFile(result.jsonPath, "utf8"));

    assert.deepEqual(json.domains, ["templates"]);
    assert.equal(result.counts.templates, 1);
    assert.equal(json.data.templates[0].name, "Ubuntu");
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
  assert.ok(configs.get("collect-context-snapshot").inputSchema.shape.profile);
  const result = await handlers.get("collect-context-snapshot")({
    domains: ["workflows"],
    profile: "vcfaBuiltIns",
  });
  assert.deepEqual(received, { domains: ["workflows"], profile: "vcfaBuiltIns" });
  assert.match(result.content[0].text, /vcfa-context\.json/);
});

test("collectContextSnapshot count matches list tool output size", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-"));
  try {
    // Client returns exactly 5 workflows and 3 actions
    const client = {
      ...baseClient(contextDir),
      listWorkflows: async () => ({
        link: [
          { id: "wf-1", name: "Alpha" },
          { id: "wf-2", name: "Beta" },
          { id: "wf-3", name: "Gamma" },
          { id: "wf-4", name: "Delta" },
          { id: "wf-5", name: "Epsilon" },
        ],
      }),
      getWorkflow: async (id) => ({
        id,
        name: id,
        description: "",
        version: "1.0.0",
        categoryName: "VCFA",
        inputParameters: [],
        outputParameters: [],
      }),
      listActions: async () => ({
        link: [
          { id: "ac-1", name: "actionOne", module: "com.example", fqn: "com.example/actionOne" },
          { id: "ac-2", name: "actionTwo", module: "com.example", fqn: "com.example/actionTwo" },
          { id: "ac-3", name: "actionThree", module: "com.example", fqn: "com.example/actionThree" },
        ],
      }),
      getAction: async (id) => ({
        id,
        name: id,
        module: "com.example",
        fqn: `com.example/${id}`,
        "input-parameters": [],
        "output-type": "void",
        script: "// no-op",
      }),
    };

    const result = await collectContextSnapshot(client, {
      fileBaseName: "count-check",
      domains: ["workflows", "actions"],
    });

    // Counts must exactly match the number of items the list tool returned
    assert.equal(result.counts.workflows, 5);
    assert.equal(result.skipped.workflows, 0);
    assert.equal(result.counts.actions, 3);
    assert.equal(result.skipped.actions, 0);

    const json = JSON.parse(await readFile(result.jsonPath, "utf8"));
    assert.equal(json.data.workflows.length, 5);
    assert.equal(json.data.actions.length, 3);
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
});

test("collectContextSnapshot workflow items contain actionable metadata for next steps", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-"));
  try {
    const result = await collectContextSnapshot(baseClient(contextDir), {
      fileBaseName: "actionable",
      domains: ["workflows", "actions"],
    });

    const json = JSON.parse(await readFile(result.jsonPath, "utf8"));

    // Workflows must carry inputs and outputs so a developer knows the contract without a follow-up get-workflow
    const workflow = json.data.workflows[0];
    assert.ok(Array.isArray(workflow.inputs), "workflow must have inputs array");
    assert.ok(Array.isArray(workflow.outputs), "workflow must have outputs array");
    assert.ok(workflow.inputs.length > 0, "workflow inputs must be populated");
    assert.ok(workflow.outputs.length > 0, "workflow outputs must be populated");
    assert.ok(typeof workflow.inputs[0].name === "string", "input must have name");
    assert.ok(typeof workflow.inputs[0].type === "string", "input must have type");

    // Actions must carry returnType and inputs so a developer can verify action contract
    const action = json.data.actions[0];
    assert.ok(typeof action.returnType === "string", "action must have returnType");
    assert.ok(Array.isArray(action.inputs), "action must have inputs array");
    assert.ok(action.inputs.length > 0, "action inputs must be populated");
    assert.ok(typeof action.inputs[0].name === "string", "action input must have name");
    assert.ok(typeof action.inputs[0].type === "string", "action input must have type");
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
});

test("collectContextSnapshot template items contain projectId for catalog-ready check", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-"));
  try {
    const result = await collectContextSnapshot(baseClient(contextDir), {
      fileBaseName: "template-meta",
      domains: ["workflows"],
      includeOptionalDomains: true,
    });

    const json = JSON.parse(await readFile(result.jsonPath, "utf8"));
    const template = json.data.templates[0];

    // projectId is required so a developer can target create-template without guessing
    assert.ok(typeof template.projectId === "string", "template must have projectId");
    assert.ok(template.projectId.length > 0, "template projectId must not be empty");

    // Content must be redacted (sha256 + length) not inline YAML
    assert.equal(template.content.included, false);
    assert.match(template.content.sha256, /^[0-9a-f]{64}$/);
    assert.ok(typeof template.content.length === "number", "content must record original length");
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
});

test("collectContextSnapshot respects maxItemsPerDomain across multiple domains", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-"));
  try {
    // 2 workflows and 1 action available; cap at 1 per domain
    const client = {
      ...baseClient(contextDir),
      listActions: async () => ({
        link: [{ id: "ac-1", name: "onlyAction", module: "com.example", fqn: "com.example/onlyAction" }],
      }),
      getAction: async (id) => ({
        id,
        name: "onlyAction",
        module: "com.example",
        fqn: "com.example/onlyAction",
        "input-parameters": [],
        "output-type": "void",
        script: "// no-op",
      }),
    };

    const result = await collectContextSnapshot(client, {
      fileBaseName: "multi-cap",
      domains: ["workflows", "actions"],
      maxItemsPerDomain: 1,
    });

    // Workflows: 2 available, 1 cap → 1 collected + 1 skipped
    assert.equal(result.counts.workflows, 1);
    assert.equal(result.skipped.workflows, 1);

    // Actions: 1 available, 1 cap → 1 collected + 0 skipped
    assert.equal(result.counts.actions, 1);
    assert.equal(result.skipped.actions, 0);
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
});
