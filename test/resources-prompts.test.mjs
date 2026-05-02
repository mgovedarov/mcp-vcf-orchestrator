import assert from "node:assert/strict";
import test from "node:test";
import { registerVcfaPrompts } from "../dist/prompts/index.js";
import { registerVcfaResources } from "../dist/resources/index.js";

function registeredResources(client) {
  const resources = new Map();
  const server = {
    registerResource(name, uriOrTemplate, config, handler) {
      resources.set(name, { uriOrTemplate, config, handler });
    },
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
    });
  assert.match(snapshot.messages[0].content.text, /Prepare project context/);
  assert.match(snapshot.messages[0].content.text, /collect-context-snapshot/);
  assert.match(snapshot.messages[0].content.text, /vcfa-discover-capabilities/);
  assert.match(snapshot.messages[0].content.text, /Include optional domains: yes/);
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
