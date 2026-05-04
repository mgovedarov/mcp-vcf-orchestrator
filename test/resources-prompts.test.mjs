import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerVcfaPrompts } from "../dist/prompts/index.js";
import { registerVcfaResources } from "../dist/resources/index.js";

function registeredResources(client, serverOverrides = {}) {
  const resources = new Map();
  const server = {
    server: {
      listRoots: async () => ({ roots: [] }),
    },
    registerResource(name, uriOrTemplate, config, handler) {
      resources.set(name, { uriOrTemplate, config, handler });
    },
    ...serverOverrides,
  };
  registerVcfaResources(server, client);
  return resources;
}

function registeredPrompts() {
  const prompts = new Map();
  const server = {
    registerPrompt(name, config, handler) {
      prompts.set(name, { config, handler });
    },
  };
  registerVcfaPrompts(server);
  return prompts;
}

test("static documentation resources return markdown content", async () => {
  const resources = registeredResources({});

  const readme = resources.get("vcfa-docs-readme");
  assert.equal(readme.config.mimeType, "text/markdown");

  const result = await readme.handler(new URL("vcfa://docs/readme"));
  assert.equal(result.contents[0].uri, "vcfa://docs/readme");
  assert.equal(result.contents[0].mimeType, "text/markdown");
  assert.match(result.contents[0].text, /MCP Server for VCF Automation/);
});

test("static schema and pattern resources return actionable content", async () => {
  const resources = registeredResources({});

  const schema = await resources
    .get("vcfa-schema-workflow-scaffold")
    .handler(new URL("vcfa://schemas/workflow-scaffold"));
  assert.equal(schema.contents[0].mimeType, "application/json");
  assert.match(schema.contents[0].text, /scaffold-workflow-file/);
  assert.match(schema.contents[0].text, /preflight-workflow-file/);

  const actionWrapper = await resources
    .get("vcfa-pattern-workflow-action-wrapper")
    .handler(new URL("vcfa://patterns/workflows/action-wrapper"));
  assert.equal(actionWrapper.contents[0].mimeType, "text/markdown");
  assert.match(actionWrapper.contents[0].text, /list-actions/);
  assert.match(actionWrapper.contents[0].text, /Do not invent parameter names/);

  const templateConventions = await resources
    .get("vcfa-template-conventions")
    .handler(new URL("vcfa://patterns/templates/conventions"));
  assert.match(templateConventions.contents[0].text, /create-template/);
  assert.match(templateConventions.contents[0].text, /do not invent/i);
});

test("dynamic resources call client methods and return json", async () => {
  const calls = [];
  const resources = registeredResources({
    getWorkflow: async (id) => {
      calls.push(["workflow", id]);
      return { id, name: "Provision VM" };
    },
    getAction: async (id) => {
      calls.push(["action", id]);
      return { id, name: "getVmIp" };
    },
    getDeployment: async (id) => {
      calls.push(["deployment", id]);
      return { id, name: "demo" };
    },
    getPackage: async (name) => {
      calls.push(["package", name]);
      return { name, version: "1.0.0" };
    },
  });

  const workflow = await resources.get("vcfa-workflow").handler(
    new URL("vcfa://workflows/workflow-1"),
    { id: "workflow-1" },
  );
  const action = await resources.get("vcfa-action").handler(
    new URL("vcfa://actions/com.example.actions.getVmIp"),
    { id: "com.example.actions.getVmIp" },
  );
  const deployment = await resources.get("vcfa-deployment").handler(
    new URL("vcfa://deployments/deployment-1"),
    { id: "deployment-1" },
  );
  const pkg = await resources.get("vcfa-package").handler(
    new URL("vcfa://packages/com.example.package"),
    { name: "com.example.package" },
  );

  assert.deepEqual(calls, [
    ["workflow", "workflow-1"],
    ["action", "com.example.actions.getVmIp"],
    ["deployment", "deployment-1"],
    ["package", "com.example.package"],
  ]);
  assert.equal(workflow.contents[0].mimeType, "application/json");
  assert.match(workflow.contents[0].text, /Provision VM/);
  assert.match(action.contents[0].text, /getVmIp/);
  assert.match(deployment.contents[0].text, /demo/);
  assert.match(pkg.contents[0].text, /com\.example\.package/);
});

test("context snapshot resources list and read persisted files", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-resources-"));
  try {
    await writeFile(join(contextDir, "snapshot.json"), JSON.stringify({ ok: true }));
    await writeFile(join(contextDir, "snapshot.md"), "# Snapshot\n");
    await writeFile(join(contextDir, "ignore.txt"), "nope");
    const resources = registeredResources({
      getContextDirectory: () => contextDir,
    });
    const contextResource = resources.get("vcfa-context-snapshot");

    const listed = await contextResource.uriOrTemplate.listCallback({});
    assert.deepEqual(
      listed.resources.map((resource) => resource.uri),
      [
        "vcfa://context/snapshots/snapshot.json",
        "vcfa://context/snapshots/snapshot.md",
      ],
    );

    const json = await contextResource.handler(
      new URL("vcfa://context/snapshots/snapshot.json"),
      { fileName: "snapshot.json" },
    );
    assert.equal(json.contents[0].mimeType, "application/json");
    assert.match(json.contents[0].text, /"ok":true/);

    const markdown = await contextResource.handler(
      new URL("vcfa://context/snapshots/snapshot.md"),
      { fileName: "snapshot.md" },
    );
    assert.equal(markdown.contents[0].mimeType, "text/markdown");
    assert.match(markdown.contents[0].text, /# Snapshot/);
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
});

test("latest context snapshot resource returns newest snapshot pair manifest", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-latest-"));
  try {
    await writeFile(
      join(contextDir, "old.json"),
      JSON.stringify({ profile: "default", counts: { workflows: 1 }, warnings: [] }),
    );
    await writeFile(join(contextDir, "old.md"), "# Old\n");
    await writeFile(
      join(contextDir, "new.json"),
      JSON.stringify({
        profile: "vcfaBuiltIns",
        counts: { actions: 5 },
        warnings: ["review"],
      }),
    );
    await writeFile(join(contextDir, "new.md"), "# New\n");
    await utimes(join(contextDir, "old.json"), new Date(1_000), new Date(1_000));
    await utimes(join(contextDir, "old.md"), new Date(1_000), new Date(1_000));
    await utimes(join(contextDir, "new.json"), new Date(2_000), new Date(2_000));
    await utimes(join(contextDir, "new.md"), new Date(2_000), new Date(2_000));

    const resources = registeredResources({
      getContextDirectory: () => contextDir,
    });
    const result = await resources
      .get("vcfa-context-latest")
      .handler(new URL("vcfa://context/latest"));
    const manifest = JSON.parse(result.contents[0].text);

    assert.equal(manifest.available, true);
    assert.equal(manifest.jsonPath, await realpath(join(contextDir, "new.json")));
    assert.equal(
      manifest.markdownPath,
      await realpath(join(contextDir, "new.md")),
    );
    assert.equal(manifest.profile, "vcfaBuiltIns");
    assert.deepEqual(manifest.counts, { actions: 5 });
    assert.equal(manifest.warningsCount, 1);
    assert.equal(manifest.resourceUris.json, "vcfa://context/snapshots/new.json");
    assert.equal(manifest.resourceUris.markdown, "vcfa://context/snapshots/new.md");
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
});

test("latest context snapshot resource reports no available snapshots", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-empty-"));
  try {
    const resources = registeredResources({
      getContextDirectory: () => contextDir,
    });
    const result = await resources
      .get("vcfa-context-latest")
      .handler(new URL("vcfa://context/latest"));
    const manifest = JSON.parse(result.contents[0].text);

    assert.equal(manifest.available, false);
    assert.equal(manifest.contextDir, contextDir);
    assert.match(manifest.message, /No context snapshot pairs/);
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
});

test("context snapshot resources reject unsafe file names and symlinks", async () => {
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-unsafe-"));
  try {
    await writeFile(join(contextDir, "snapshot.json"), "{}");
    await symlink(join(contextDir, "snapshot.json"), join(contextDir, "link.json"));
    const resources = registeredResources({
      getContextDirectory: () => contextDir,
    });
    const contextResource = resources.get("vcfa-context-snapshot");

    await assert.rejects(
      contextResource.handler(new URL("vcfa://context/snapshots/bad.txt"), {
        fileName: "bad.txt",
      }),
      /must end with .json or .md/,
    );
    await assert.rejects(
      contextResource.handler(new URL("vcfa://context/snapshots/..%2Fbad.json"), {
        fileName: "../bad.json",
      }),
      /must not contain path separators/,
    );
    await assert.rejects(
      contextResource.handler(new URL("vcfa://context/snapshots/missing.json"), {
        fileName: "missing.json",
      }),
      /was not found/,
    );
    await assert.rejects(
      contextResource.handler(new URL("vcfa://context/snapshots/link.json"), {
        fileName: "link.json",
      }),
      /must not be a symbolic link/,
    );
  } finally {
    await rm(contextDir, { recursive: true, force: true });
  }
});

test("prompts return workflow instructions with provided arguments", async () => {
  const prompts = registeredPrompts();

  const author = await prompts.get("vcfa-author-workflow").handler({
    goal: "Provision a small Linux VM",
    categoryHint: "Dev",
  });
  assert.match(author.description, /Author/);
  assert.match(author.messages[0].content.text, /Provision a small Linux VM/);
  assert.match(author.messages[0].content.text, /Category hint: Dev/);
  assert.match(author.messages[0].content.text, /preflight-workflow-file/);

  const review = await prompts.get("vcfa-review-artifact-import").handler({
    artifactKind: "workflow",
    fileName: "linux.workflow",
  });
  assert.match(review.messages[0].content.text, /Artifact kind: workflow/);
  assert.match(review.messages[0].content.text, /linux\.workflow/);

  const troubleshoot = await prompts
    .get("vcfa-troubleshoot-deployment")
    .handler({ deploymentId: "deployment-1" });
  assert.match(troubleshoot.messages[0].content.text, /deployment-1/);
  assert.match(troubleshoot.messages[0].content.text, /list-deployment-actions/);

  const discover = await prompts
    .get("vcfa-discover-capabilities")
    .handler({ goal: "Find NSX automation coverage" });
  assert.match(discover.messages[0].content.text, /NSX automation coverage/);
  assert.match(discover.messages[0].content.text, /installed plugins/);
  assert.match(discover.messages[0].content.text, /Do not invent IDs/);

  const snapshot = await prompts
    .get("vcfa-collect-context-snapshot")
    .handler({
      goal: "Prepare project context",
      includeOptionalDomains: true,
      profile: "vcfaBuiltIns",
    });
  assert.match(snapshot.messages[0].content.text, /Prepare project context/);
  assert.match(snapshot.messages[0].content.text, /collect-context-snapshot/);
  assert.match(snapshot.messages[0].content.text, /vcfa-discover-capabilities/);
  assert.match(snapshot.messages[0].content.text, /Include optional domains: yes/);
  assert.match(snapshot.messages[0].content.text, /Profile: vcfaBuiltIns/);
  assert.match(snapshot.messages[0].content.text, /workflows in subfolders below Library/);
});

test("implementation prompts include discovery-first guardrails", async () => {
  const prompts = registeredPrompts();

  const fromAction = await prompts
    .get("vcfa-build-workflow-from-action")
    .handler({
      actionHint: "com.example.actions.getVmIp",
      workflowGoal: "Expose VM IP lookup",
      categoryHint: "VCFA",
    });
  assert.match(fromAction.messages[0].content.text, /get-action/);
  assert.match(fromAction.messages[0].content.text, /action-wrapper/);
  assert.match(fromAction.messages[0].content.text, /Do not invent IDs/);
  assert.match(fromAction.messages[0].content.text, /partial\/ambiguous action data/);
  assert.match(fromAction.messages[0].content.text, /instead of inventing parameter names or return types/);

  const refactor = await prompts.get("vcfa-refactor-workflow").handler({
    workflowHint: "List VMs",
    refactorGoal: "Extract reusable action calls",
  });
  assert.match(refactor.messages[0].content.text, /export-workflow-file/);
  assert.match(refactor.messages[0].content.text, /diff-workflow-file/);

  const createTemplate = await prompts.get("vcfa-create-template").handler({
    templateGoal: "Small Ubuntu VM",
    projectHint: "MainPrj",
  });
  assert.match(createTemplate.messages[0].content.text, /list-templates/);
  assert.match(createTemplate.messages[0].content.text, /create-template only after/);

  const reviewTemplate = await prompts.get("vcfa-review-template").handler({
    templateId: "template-1",
    reviewGoal: "catalog readiness",
  });
  assert.match(reviewTemplate.messages[0].content.text, /get-template/);
  assert.match(reviewTemplate.messages[0].content.text, /Do not invent IDs/);

  const integration = await prompts
    .get("vcfa-integrate-workflow-template-subscription")
    .handler({
      integrationGoal: "Run workflow after deployment creation",
      workflowHint: "Tag VM",
      templateHint: "Ubuntu",
    });
  assert.match(integration.messages[0].content.text, /list-event-topics/);
  assert.match(integration.messages[0].content.text, /create-subscription/);

  const plan = await prompts
    .get("vcfa-discovery-first-implementation-plan")
    .handler({
      goal: "Create reusable deployment workflow",
      artifactKinds: "workflows and templates",
    });
  assert.match(plan.messages[0].content.text, /read-only discovery/);
  assert.match(plan.messages[0].content.text, /preflight\/diff/);
  assert.match(plan.messages[0].content.text, /get-action must verify its contract/);
});

test("vcfa-discover-capabilities prompt references all discovery tool families", async () => {
  const prompts = registeredPrompts();

  const discover = await prompts
    .get("vcfa-discover-capabilities")
    .handler({ goal: "Audit VM provisioning coverage" });

  const text = discover.messages[0].content.text;

  // Goal is interpolated
  assert.match(text, /Audit VM provisioning coverage/);

  // Mentions the key discovery domains from its description
  assert.match(text, /plugins/);
  assert.match(text, /categories/);
  assert.match(text, /workflows/);
  assert.match(text, /actions/);
  assert.match(text, /catalog items/);
  assert.match(text, /templates/);

  // Discovery-first guardrail: stop and report, do not invent
  assert.match(text, /Do not invent IDs/);
  assert.match(text, /stop and report/);

  // Recommends concrete next tool calls, not creation
  assert.match(text, /avoid creating or importing artifacts/);
  assert.match(text, /Summarize what already exists/);
});

test("vcfa-discover-capabilities prompt works without optional goal", async () => {
  const prompts = registeredPrompts();

  const discover = await prompts
    .get("vcfa-discover-capabilities")
    .handler({});

  const text = discover.messages[0].content.text;
  assert.match(text, /discover relevant VCFA capabilities/);
  assert.match(text, /Do not invent IDs/);
});

test("all discovery pattern resources contain discovery-first instructions", async () => {
  const resources = registeredResources({});

  const basicTask = await resources
    .get("vcfa-pattern-workflow-basic-scriptable-task")
    .handler(new URL("vcfa://patterns/workflows/basic-scriptable-task"));
  assert.equal(basicTask.contents[0].mimeType, "text/markdown");
  assert.match(basicTask.contents[0].text, /list-categories/);
  assert.match(basicTask.contents[0].text, /list-workflows/);
  assert.match(basicTask.contents[0].text, /scaffold-workflow-file/);
  assert.match(basicTask.contents[0].text, /preflight-workflow-file/);
  assert.match(basicTask.contents[0].text, /import-workflow-file/);

  const smallVm = await resources
    .get("vcfa-pattern-template-small-vm")
    .handler(new URL("vcfa://patterns/templates/small-vm"));
  assert.equal(smallVm.contents[0].mimeType, "text/markdown");
  assert.match(smallVm.contents[0].text, /list-templates/);
  assert.match(smallVm.contents[0].text, /get-template/);
  assert.match(smallVm.contents[0].text, /create-template/);
  assert.match(smallVm.contents[0].text, /do not guess/i);

  const catalogReady = await resources
    .get("vcfa-pattern-template-catalog-ready")
    .handler(new URL("vcfa://patterns/templates/catalog-ready"));
  assert.equal(catalogReady.contents[0].mimeType, "text/markdown");
  assert.match(catalogReady.contents[0].text, /list-catalog-items/);
  assert.match(catalogReady.contents[0].text, /list-deployments/);
  assert.match(catalogReady.contents[0].text, /stop and report/);
});

test("workflow-scaffold schema resource contains all required contract fields", async () => {
  const resources = registeredResources({});

  const schema = await resources
    .get("vcfa-schema-workflow-scaffold")
    .handler(new URL("vcfa://schemas/workflow-scaffold"));

  assert.equal(schema.contents[0].mimeType, "application/json");
  const parsed = JSON.parse(schema.contents[0].text);

  // Top-level contract shape
  assert.ok(parsed.tool, "schema must have tool field");
  assert.equal(parsed.tool, "scaffold-workflow-file");
  assert.ok(parsed.workflow, "schema must have workflow field");
  assert.ok(Array.isArray(parsed.nextSteps), "schema must have nextSteps array");

  // Workflow fields required for discovery-to-scaffold flow
  assert.ok(parsed.workflow.inputs, "schema must describe inputs");
  assert.ok(parsed.workflow.outputs, "schema must describe outputs");
  assert.ok(parsed.workflow.tasks, "schema must describe tasks");

  // Validation info for scaffold rules
  assert.ok(parsed.validation, "schema must describe validation rules");
  assert.match(parsed.validation, /binding|parameter names|task/);

  // Next steps enforce preflight before import
  const steps = parsed.nextSteps.join(" ");
  assert.match(steps, /preflight-workflow-file/);
  assert.match(steps, /import/i);
});
