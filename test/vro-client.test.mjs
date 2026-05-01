import { zipSync } from "fflate";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildWorkflowArtifact } from "../dist/client/workflow-artifact.js";
import { VroClient } from "../dist/vro-client.js";

const config = (overrides = {}) => ({
  host: "vcfa.example.test",
  username: "admin",
  organization: "org",
  password: "secret",
  ...overrides,
});

function authResponse() {
  return new Response("", {
    status: 200,
    headers: { "x-vmware-vcloud-access-token": "token" },
  });
}

test("artifact directories default to temp subdirectories", () => {
  const client = new VroClient(config());
  const root = join(tmpdir(), "mcp-vcf-orchestrator");

  assert.equal(client.getPackageDirectory(), join(root, "packages"));
  assert.equal(client.getResourceDirectory(), join(root, "resources"));
  assert.equal(client.getWorkflowDirectory(), join(root, "workflows"));
  assert.equal(client.getActionDirectory(), join(root, "actions"));
  assert.equal(
    client.getConfigurationDirectory(),
    join(root, "configurations"),
  );
});

test("artifactDir config derives artifact type subdirectories", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "vcfa-artifacts-"));

  try {
    const client = new VroClient(config({ artifactDir }));

    assert.equal(client.getPackageDirectory(), join(artifactDir, "packages"));
    assert.equal(client.getResourceDirectory(), join(artifactDir, "resources"));
    assert.equal(client.getWorkflowDirectory(), join(artifactDir, "workflows"));
    assert.equal(client.getActionDirectory(), join(artifactDir, "actions"));
    assert.equal(
      client.getConfigurationDirectory(),
      join(artifactDir, "configurations"),
    );
  } finally {
    await rm(artifactDir, { recursive: true, force: true });
  }
});

test("specific artifact directories override artifactDir", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "vcfa-artifacts-"));
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-workflows-"));

  try {
    const client = new VroClient(config({ artifactDir, workflowDir }));

    assert.equal(client.getWorkflowDirectory(), workflowDir);
    assert.equal(client.getPackageDirectory(), join(artifactDir, "packages"));
    assert.equal(client.getResourceDirectory(), join(artifactDir, "resources"));
    assert.equal(client.getActionDirectory(), join(artifactDir, "actions"));
    assert.equal(
      client.getConfigurationDirectory(),
      join(artifactDir, "configurations"),
    );
  } finally {
    await rm(artifactDir, { recursive: true, force: true });
    await rm(workflowDir, { recursive: true, force: true });
  }
});

function xmlArchive(rootName) {
  return zipSync({
    "artifact.xml": new TextEncoder().encode(`<${rootName} name="payload" />`),
  });
}

function minimalWorkflowArtifact() {
  return buildWorkflowArtifact({
    name: "Payload",
    outputs: [{ name: "result", type: "string" }],
    tasks: [
      {
        script: 'result = "ok";',
        outBindings: [{ name: "result", type: "string", target: "result" }],
      },
    ],
  });
}

function actionArchive(overrides = {}) {
  const action = {
    id: "action-1",
    name: "echo",
    module: "com.example.actions",
    fqn: "com.example.actions.echo",
    version: "1.0.0",
    returnType: "string",
    description: "Echo",
    inputParameters: [
      { name: "message", type: "string", description: "Message" },
    ],
    script: "return message;",
    ...overrides,
  };
  const params = action.inputParameters
    .map(
      (param) =>
        `<param name="${escapeXml(param.name)}" type="${escapeXml(param.type)}"><description>${escapeXml(param.description ?? "")}</description></param>`,
    )
    .join("");
  return zipSync({
    "action.xml": new TextEncoder().encode(
      `<action id="${escapeXml(action.id)}" name="${escapeXml(action.name)}" module="${escapeXml(action.module)}" fqn="${escapeXml(action.fqn)}" version="${escapeXml(action.version)}" output-type="${escapeXml(action.returnType)}"><description>${escapeXml(action.description)}</description><input-parameters>${params}</input-parameters><script><![CDATA[${action.script}]]></script></action>`,
    ),
  });
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

test("bodyless 202 responses with Location return an execution id", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("", {
      status: 202,
      headers: {
        location:
          "https://vcfa.example.test/vco/api/workflows/wf/executions/execution-123",
      },
    });
  };

  const client = new VroClient(config());
  const execution = await client.runWorkflow("workflow-1");

  assert.equal(execution.id, "execution-123");
  assert.equal(execution.state, "running");
  assert.equal(calls.length, 2);
});

test("getWorkflowExecution can request detailed execution data", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({ id: "execution-1", state: "RUNNING" });
  };

  const client = new VroClient(config());
  const execution = await client.getWorkflowExecution("workflow 1", "exec/1", {
    showDetails: true,
  });

  assert.equal(execution.id, "execution-1");
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/workflows/workflow%201/executions/exec%2F1?showDetails=true",
  );
  assert.equal(calls[1].init.method, "GET");
});

test("getWorkflowExecutionLogs calls workflow execution logs endpoint", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({
      logs: [{ severity: "INFO", "short-description": "hello" }],
    });
  };

  const client = new VroClient(config());
  const logs = await client.getWorkflowExecutionLogs(
    "workflow-1",
    "execution-1",
    { maxResult: 3 },
  );

  assert.equal(logs.logs[0]["short-description"], "hello");
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/workflows/workflow-1/executions/execution-1/logs?maxResult=3",
  );
  assert.equal(calls[1].init.method, "GET");
});

test("diffActionFile compares live export to local action artifact as zip", async () => {
  const actionDir = await mkdtemp(join(tmpdir(), "vcfa-actions-live-"));
  await writeFile(join(actionDir, "local.action"), actionArchive({ name: "local" }));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response(actionArchive({ name: "live" }));
  };

  try {
    const client = new VroClient(config({ actionDir }));
    const diff = await client.diffActionFile({
      base: { source: "live", actionId: "action-1" },
      compare: { source: "file", fileName: "local.action" },
    });

    assert.match(diff, /name: "live" -> "local"/);
    assert.equal(
      calls[1].url,
      "https://vcfa.example.test/vco/api/actions/action-1",
    );
    assert.equal(calls[1].init.method, "GET");
    assert.equal(calls[1].init.headers.Accept, "application/zip");
  } finally {
    await rm(actionDir, { recursive: true, force: true });
  }
});

test("createConfiguration sends singular attribute payload", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({ id: "config-1", name: "Settings" });
  };

  const client = new VroClient(config());
  await client.createConfiguration("category-1", "Settings", "desc", [
    { name: "host", type: "string", value: "vcfa.example.test" },
  ]);

  const body = JSON.parse(calls[1].init.body);
  assert.deepEqual(body, {
    name: "Settings",
    "category-id": "category-1",
    description: "desc",
    attribute: [
      {
        name: "host",
        type: "string",
        value: { string: { value: "vcfa.example.test" } },
      },
    ],
  });
});

test("catalog client uses service broker endpoints and request payloads", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();

    if (String(url).endsWith("/catalog/api/items?$search=ubuntu%2022")) {
      return Response.json({
        totalElements: 1,
        content: [{ id: "catalog-1", name: "Ubuntu 22" }],
      });
    }

    if (String(url).endsWith("/catalog/api/items/catalog%2F1")) {
      return Response.json({ id: "catalog/1", name: "Ubuntu" });
    }

    return Response.json({ id: "deployment-1", name: "Ubuntu Deployment" });
  };

  const client = new VroClient(config());
  const list = await client.listCatalogItems("ubuntu 22");
  const item = await client.getCatalogItem("catalog/1");
  const deployment = await client.createDeploymentFromCatalogItem({
    catalogItemId: "catalog/1",
    deploymentName: "Ubuntu Deployment",
    projectId: "project-1",
    version: "1.0.0",
    reason: "Test",
    inputs: { size: "small" },
  });

  assert.equal(list.content[0].id, "catalog-1");
  assert.equal(item.id, "catalog/1");
  assert.equal(deployment.id, "deployment-1");
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/catalog/api/items?$search=ubuntu%2022",
  );
  assert.equal(
    calls[2].url,
    "https://vcfa.example.test/catalog/api/items/catalog%2F1",
  );
  assert.equal(
    calls[3].url,
    "https://vcfa.example.test/catalog/api/items/catalog%2F1/request",
  );
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    deploymentName: "Ubuntu Deployment",
    projectId: "project-1",
    version: "1.0.0",
    reason: "Test",
    inputs: { size: "small" },
  });
});

test("template client uses blueprint endpoints and optional payload fields", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();

    if (String(url).includes("/blueprint/api/blueprints?")) {
      return Response.json({
        totalElements: 1,
        content: [{ id: "template-1", name: "Small VM" }],
      });
    }

    if (init.method === "GET") {
      return Response.json({ id: "template/1", name: "Small VM" });
    }

    if (init.method === "POST") {
      return Response.json({ id: "template-2", name: "New VM" });
    }

    return new Response(null, { status: 204 });
  };

  const client = new VroClient(config());
  const list = await client.listTemplates("small vm", "project/1");
  const detail = await client.getTemplate("template/1");
  const created = await client.createTemplate({
    name: "New VM",
    projectId: "project/1",
    description: "Demo",
    content: "formatVersion: 1",
    requestScopeOrg: true,
  });
  await client.deleteTemplate("template/2");

  assert.equal(list.content[0].id, "template-1");
  assert.equal(detail.id, "template/1");
  assert.equal(created.id, "template-2");
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/blueprint/api/blueprints?$search=small%20vm&projectId=project%2F1",
  );
  assert.equal(
    calls[2].url,
    "https://vcfa.example.test/blueprint/api/blueprints/template%2F1",
  );
  assert.equal(
    calls[3].url,
    "https://vcfa.example.test/blueprint/api/blueprints",
  );
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    name: "New VM",
    projectId: "project/1",
    description: "Demo",
    content: "formatVersion: 1",
    requestScopeOrg: true,
  });
  assert.equal(
    calls[4].url,
    "https://vcfa.example.test/blueprint/api/blueprints/template%2F2",
  );
  assert.equal(calls[4].init.method, "DELETE");
});

test("subscription client uses event broker endpoints and payloads", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();

    if (String(url).endsWith("/event-broker/api/topics")) {
      return Response.json({ content: [{ id: "topic-1" }] });
    }

    if (init.method === "GET") {
      return Response.json({ content: [{ id: "sub-1" }] });
    }

    if (init.method === "POST" || init.method === "PUT") {
      return Response.json({ id: "sub-1", name: "Approval" });
    }

    return new Response(null, { status: 204 });
  };

  const client = new VroClient(config());
  const topics = await client.listEventTopics();
  const subscriptions = await client.listSubscriptions("project/1");
  await client.createSubscription({
    name: "Approval",
    eventTopicId: "topic-1",
    runnableType: "extensibility.vro",
    runnableId: "workflow-1",
    projectId: "project/1",
    blocking: true,
    priority: 10,
    timeout: 30,
    disabled: false,
    constraints: { projectId: "project/1" },
  });
  await client.updateSubscription("sub/1", {
    disabled: true,
    runnableId: "workflow-2",
  });
  await client.deleteSubscription("sub/1");

  assert.equal(topics.content[0].id, "topic-1");
  assert.equal(subscriptions.content[0].id, "sub-1");
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/event-broker/api/topics",
  );
  assert.equal(
    calls[2].url,
    "https://vcfa.example.test/event-broker/api/subscriptions?$filter=projectId eq 'project%2F1'",
  );
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    name: "Approval",
    type: "RUNNABLE",
    eventTopicId: "topic-1",
    runnableType: "extensibility.vro",
    runnableId: "workflow-1",
    projectId: "project/1",
    blocking: true,
    priority: 10,
    timeout: 30,
    disabled: false,
    constraints: { projectId: "project/1" },
  });
  assert.equal(
    calls[4].url,
    "https://vcfa.example.test/event-broker/api/subscriptions/sub%2F1",
  );
  assert.deepEqual(JSON.parse(calls[4].init.body), {
    disabled: true,
    runnableId: "workflow-2",
  });
  assert.equal(calls[5].init.method, "DELETE");
});

test("category and plugin clients parse attribute links", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();

    if (String(url).includes("/categories")) {
      return Response.json({
        total: 1,
        link: [
          {
            attributes: [
              { name: "id", value: "category-1" },
              { name: "name", value: "Provisioning" },
              { name: "path", value: "/Library/Provisioning" },
            ],
          },
        ],
      });
    }

    return Response.json({
      total: 1,
      link: [
        {
          attributes: [
            { name: "name", value: "com.vmware.library" },
            { name: "display-name", value: "VMware Library" },
            { name: "version", value: "1.0.0" },
          ],
        },
      ],
    });
  };

  const client = new VroClient(config());
  const categories = await client.listCategories(
    "WorkflowCategory",
    "Provisioning",
  );
  const plugins = await client.listPlugins("library");

  assert.deepEqual(categories.link, [
    {
      id: "category-1",
      name: "Provisioning",
      description: undefined,
      type: "WorkflowCategory",
      path: "/Library/Provisioning",
    },
  ]);
  assert.deepEqual(plugins.link, [
    {
      name: "com.vmware.library",
      displayName: "VMware Library",
      version: "1.0.0",
      description: undefined,
      type: undefined,
    },
  ]);
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/categories?categoryType=WorkflowCategory&conditions=name~Provisioning",
  );
  assert.equal(
    calls[2].url,
    "https://vcfa.example.test/vco/api/plugins?conditions=name~library",
  );
});

test("package import rejects path traversal before network calls", async () => {
  const packageDir = await mkdtemp(join(tmpdir(), "vcfa-packages-"));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return authResponse();
  };

  try {
    const client = new VroClient(config({ packageDir }));
    await assert.rejects(
      () => client.importPackage("../secret.package"),
      /must not contain path separators/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(packageDir, { recursive: true, force: true });
  }
});

test("package export rejects existing files unless overwrite is true", async () => {
  const packageDir = await mkdtemp(join(tmpdir(), "vcfa-packages-"));
  await writeFile(join(packageDir, "existing.package"), "old");
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return authResponse();
  };

  try {
    const client = new VroClient(config({ packageDir }));
    await assert.rejects(
      () => client.exportPackage("com.example", "existing.package"),
      /already exists/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(packageDir, { recursive: true, force: true });
  }
});

test("package import rejects symbolic links", async () => {
  const packageDir = await mkdtemp(join(tmpdir(), "vcfa-packages-"));
  const outsideFile = join(tmpdir(), `outside-${Date.now()}.package`);
  await writeFile(outsideFile, "package");
  await symlink(outsideFile, join(packageDir, "linked.package"));

  try {
    const client = new VroClient(config({ packageDir }));
    await assert.rejects(
      () => client.importPackage("linked.package"),
      /must not be a symbolic link/,
    );
  } finally {
    await rm(packageDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
});

test("package import sends multipart file and overwrite query", async () => {
  const packageDir = await mkdtemp(join(tmpdir(), "vcfa-packages-"));
  await writeFile(join(packageDir, "payload.package"), xmlArchive("package"));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("", { status: 202 });
  };

  try {
    const client = new VroClient(config({ packageDir }));
    await client.importPackage("payload.package", false);

    assert.equal(
      calls[1].url,
      "https://vcfa.example.test/vco/api/packages?overwrite=false",
    );
    assert.equal(calls[1].init.method, "POST");
    assert.equal(calls[1].init.headers["Content-Type"], undefined);
    const body = calls[1].init.body;
    assert.equal(body.get("file").name, "payload.package");
  } finally {
    await rm(packageDir, { recursive: true, force: true });
  }
});

test("deletePackage sends documented option query", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response(null, { status: 204 });
  };

  const client = new VroClient(config());
  await client.deletePackage("com.example", true);

  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/packages/com.example?option=deletePackageWithContent",
  );
  assert.equal(calls[1].init.method, "DELETE");
});

test("ignoreTls config disables TLS verification for library callers", () => {
  const previous = process.env["NODE_TLS_REJECT_UNAUTHORIZED"];

  try {
    delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
    new VroClient(config({ ignoreTls: true }));
    assert.equal(process.env["NODE_TLS_REJECT_UNAUTHORIZED"], "0");
  } finally {
    if (previous === undefined) {
      delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
    } else {
      process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = previous;
    }
  }
});

test("workflow import rejects path traversal before network calls", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-workflows-"));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return authResponse();
  };

  try {
    const client = new VroClient(config({ workflowDir }));
    await assert.rejects(
      () => client.importWorkflowFile("category-1", "../secret.workflow"),
      /must not contain path separators/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

test("workflow export rejects existing files unless overwrite is true", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-workflows-"));
  await writeFile(join(workflowDir, "existing.workflow"), "old");
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return authResponse();
  };

  try {
    const client = new VroClient(config({ workflowDir }));
    await assert.rejects(
      () => client.exportWorkflowFile("workflow-1", "existing.workflow"),
      /already exists/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

test("workflow import rejects symbolic links", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-workflows-"));
  const outsideFile = join(tmpdir(), `outside-${Date.now()}.workflow`);
  await writeFile(outsideFile, "workflow");
  await symlink(outsideFile, join(workflowDir, "linked.workflow"));

  try {
    const client = new VroClient(config({ workflowDir }));
    await assert.rejects(
      () => client.importWorkflowFile("category-1", "linked.workflow"),
      /must not be a symbolic link/,
    );
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
});

test("workflow import sends multipart file with category and overwrite query", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-workflows-"));
  await writeFile(
    join(workflowDir, "payload.workflow"),
    minimalWorkflowArtifact(),
  );
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("", { status: 200 });
  };

  try {
    const client = new VroClient(config({ workflowDir }));
    await client.importWorkflowFile("category-1", "payload.workflow", false);

    assert.equal(
      calls[1].url,
      "https://vcfa.example.test/vco/api/workflows?categoryId=category-1&overwrite=false",
    );
    assert.equal(calls[1].init.method, "POST");
    assert.equal(calls[1].init.headers["Content-Type"], undefined);
    const body = calls[1].init.body;
    assert.equal(body.get("file").name, "payload.workflow");
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

test("workflow export writes only under workflow directory", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-workflows-"));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("workflow-bytes", { status: 200 });
  };

  try {
    const client = new VroClient(config({ workflowDir }));
    const savedPath = await client.exportWorkflowFile(
      "workflow-1",
      "saved.workflow",
    );

    assert.equal(
      savedPath,
      join(await realpath(workflowDir), "saved.workflow"),
    );
    assert.equal(
      calls[1].url,
      "https://vcfa.example.test/vco/api/content/workflows/workflow-1",
    );
    assert.equal(calls[1].init.method, "GET");
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

test("workflow diff compares local files and rejects unsafe paths", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-workflows-"));
  await writeFile(join(workflowDir, "base.workflow"), buildWorkflowArtifact({
    id: "workflow-1",
    name: "Workflow",
    inputs: [{ name: "message", type: "string" }],
    tasks: [{ script: "System.log(message);" }],
  }));
  await writeFile(join(workflowDir, "compare.workflow"), buildWorkflowArtifact({
    id: "workflow-1",
    name: "Workflow",
    inputs: [{ name: "message", type: "string" }, { name: "count", type: "number" }],
    tasks: [{ script: "System.log(message);" }],
  }));
  await writeFile(join(workflowDir, "bad.workflow"), "not a zip");
  const outsideFile = join(tmpdir(), `outside-${Date.now()}.workflow`);
  await writeFile(outsideFile, buildWorkflowArtifact({
    id: "workflow-1",
    name: "Outside",
    tasks: [{ script: "System.log('outside');" }],
  }));
  await symlink(outsideFile, join(workflowDir, "linked.workflow"));

  try {
    const client = new VroClient(config({ workflowDir }));
    const diff = await client.diffWorkflowFile({
      base: { source: "file", fileName: "base.workflow" },
      compare: { source: "file", fileName: "compare.workflow" },
    });
    assert.match(diff, /Added parameter count/);

    await assert.rejects(
      () => client.diffWorkflowFile({
        base: { source: "file", fileName: "../base.workflow" },
        compare: { source: "file", fileName: "compare.workflow" },
      }),
      /path separators/,
    );
    await assert.rejects(
      () => client.diffWorkflowFile({
        base: { source: "file", fileName: "bad.workflow" },
        compare: { source: "file", fileName: "compare.workflow" },
      }),
      /valid ZIP archive/,
    );
    await assert.rejects(
      () => client.diffWorkflowFile({
        base: { source: "file", fileName: "linked.workflow" },
        compare: { source: "file", fileName: "compare.workflow" },
      }),
      /symbolic link/,
    );
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
});

test("workflow diff can compare live export buffer against local file", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-workflows-"));
  const local = buildWorkflowArtifact({
    id: "workflow-1",
    name: "Workflow",
    inputs: [{ name: "message", type: "string" }],
    tasks: [{ script: "System.log(message);" }],
  });
  const live = buildWorkflowArtifact({
    id: "workflow-1",
    name: "Workflow",
    inputs: [{ name: "message", type: "string" }],
    tasks: [{ script: "System.warn(message);" }],
  });
  await writeFile(join(workflowDir, "local.workflow"), local);
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response(live, { status: 200 });
  };

  try {
    const client = new VroClient(config({ workflowDir }));
    const diff = await client.diffWorkflowFile({
      base: { source: "live", workflowId: "workflow-1" },
      compare: { source: "file", fileName: "local.workflow" },
    });

    assert.match(diff, /script changed/);
    assert.equal(
      calls[1].url,
      "https://vcfa.example.test/vco/api/content/workflows/workflow-1",
    );
    assert.equal(calls[1].init.headers.Accept, "application/zip");
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

test("action import rejects path traversal before network calls", async () => {
  const actionDir = await mkdtemp(join(tmpdir(), "vcfa-actions-"));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return authResponse();
  };

  try {
    const client = new VroClient(config({ actionDir }));
    await assert.rejects(
      () => client.importActionFile("com.example", "../secret.action"),
      /must not contain path separators/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(actionDir, { recursive: true, force: true });
  }
});

test("action export rejects existing files unless overwrite is true", async () => {
  const actionDir = await mkdtemp(join(tmpdir(), "vcfa-actions-"));
  await writeFile(join(actionDir, "existing.action"), "old");
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return authResponse();
  };

  try {
    const client = new VroClient(config({ actionDir }));
    await assert.rejects(
      () => client.exportActionFile("action-1", "existing.action"),
      /already exists/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(actionDir, { recursive: true, force: true });
  }
});

test("action import rejects symbolic links", async () => {
  const actionDir = await mkdtemp(join(tmpdir(), "vcfa-actions-"));
  const outsideFile = join(tmpdir(), `outside-${Date.now()}.action`);
  await writeFile(outsideFile, "action");
  await symlink(outsideFile, join(actionDir, "linked.action"));

  try {
    const client = new VroClient(config({ actionDir }));
    await assert.rejects(
      () => client.importActionFile("com.example", "linked.action"),
      /must not be a symbolic link/,
    );
  } finally {
    await rm(actionDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
});

test("action import sends multipart file and category name", async () => {
  const actionDir = await mkdtemp(join(tmpdir(), "vcfa-actions-"));
  await writeFile(join(actionDir, "payload.action"), xmlArchive("action"));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("", { status: 202 });
  };

  try {
    const client = new VroClient(config({ actionDir }));
    await client.importActionFile("com.example.actions", "payload.action");

    assert.equal(calls[1].url, "https://vcfa.example.test/vco/api/actions");
    assert.equal(calls[1].init.method, "POST");
    assert.equal(calls[1].init.headers["Content-Type"], undefined);
    const body = calls[1].init.body;
    assert.equal(body.get("categoryName"), "com.example.actions");
    assert.equal(body.get("file").name, "payload.action");
  } finally {
    await rm(actionDir, { recursive: true, force: true });
  }
});

test("getAction resolves listed action ids to definition endpoint", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    if (calls.length === 2) {
      return Response.json({
        link: [
          {
            attribute: [
              { name: "id", value: "action-1" },
              { name: "name", value: "getVmIp" },
              { name: "module", value: "com.example.actions" },
            ],
          },
        ],
      });
    }
    return Response.json({
      id: "action-1",
      name: "getVmIp",
      module: "com.example.actions",
      script: "return vm.ipAddress;",
    });
  };

  const client = new VroClient(config());
  const action = await client.getAction("action-1");

  assert.equal(
    calls[2].url,
    "https://vcfa.example.test/vco/api/actions/com.example.actions/getVmIp",
  );
  assert.equal(calls[2].init.method, "GET");
  assert.equal(action.script, "return vm.ipAddress;");
});

test("getAction accepts fully-qualified action names", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({
      id: "action-1",
      name: "getVmIp",
      module: "com.example.actions",
    });
  };

  const client = new VroClient(config());
  await client.getAction("com.example.actions.getVmIp");

  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/actions/com.example.actions/getVmIp",
  );
});

test("action export writes only under action directory", async () => {
  const actionDir = await mkdtemp(join(tmpdir(), "vcfa-actions-"));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("action-bytes", { status: 200 });
  };

  try {
    const client = new VroClient(config({ actionDir }));
    const savedPath = await client.exportActionFile("action-1", "saved.action");

    assert.equal(savedPath, join(await realpath(actionDir), "saved.action"));
    assert.equal(
      calls[1].url,
      "https://vcfa.example.test/vco/api/actions/action-1",
    );
    assert.equal(calls[1].init.method, "GET");
  } finally {
    await rm(actionDir, { recursive: true, force: true });
  }
});

test("configuration import rejects path traversal before network calls", async () => {
  const configurationDir = await mkdtemp(
    join(tmpdir(), "vcfa-configurations-"),
  );
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return authResponse();
  };

  try {
    const client = new VroClient(config({ configurationDir }));
    await assert.rejects(
      () => client.importConfigurationFile("category-1", "../secret.vsoconf"),
      /must not contain path separators/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(configurationDir, { recursive: true, force: true });
  }
});

test("configuration export rejects existing files unless overwrite is true", async () => {
  const configurationDir = await mkdtemp(
    join(tmpdir(), "vcfa-configurations-"),
  );
  await writeFile(join(configurationDir, "existing.vsoconf"), "old");
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return authResponse();
  };

  try {
    const client = new VroClient(config({ configurationDir }));
    await assert.rejects(
      () =>
        client.exportConfigurationFile("configuration-1", "existing.vsoconf"),
      /already exists/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(configurationDir, { recursive: true, force: true });
  }
});

test("configuration import rejects symbolic links", async () => {
  const configurationDir = await mkdtemp(
    join(tmpdir(), "vcfa-configurations-"),
  );
  const outsideFile = join(tmpdir(), `outside-${Date.now()}.vsoconf`);
  await writeFile(outsideFile, "configuration");
  await symlink(outsideFile, join(configurationDir, "linked.vsoconf"));

  try {
    const client = new VroClient(config({ configurationDir }));
    await assert.rejects(
      () => client.importConfigurationFile("category-1", "linked.vsoconf"),
      /must not be a symbolic link/,
    );
  } finally {
    await rm(configurationDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
});

test("configuration import sends multipart file and category id", async () => {
  const configurationDir = await mkdtemp(
    join(tmpdir(), "vcfa-configurations-"),
  );
  await writeFile(
    join(configurationDir, "payload.vsoconf"),
    xmlArchive("configuration"),
  );
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("", { status: 202 });
  };

  try {
    const client = new VroClient(config({ configurationDir }));
    await client.importConfigurationFile("category-1", "payload.vsoconf");

    assert.equal(
      calls[1].url,
      "https://vcfa.example.test/vco/api/configurations",
    );
    assert.equal(calls[1].init.method, "POST");
    assert.equal(calls[1].init.headers["Content-Type"], undefined);
    const body = calls[1].init.body;
    assert.equal(body.get("categoryId"), "category-1");
    assert.equal(body.get("file").name, "payload.vsoconf");
  } finally {
    await rm(configurationDir, { recursive: true, force: true });
  }
});

test("configuration export writes only under configuration directory", async () => {
  const configurationDir = await mkdtemp(
    join(tmpdir(), "vcfa-configurations-"),
  );
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("configuration-bytes", { status: 200 });
  };

  try {
    const client = new VroClient(config({ configurationDir }));
    const savedPath = await client.exportConfigurationFile(
      "configuration-1",
      "saved.vsoconf",
    );

    assert.equal(
      savedPath,
      join(await realpath(configurationDir), "saved.vsoconf"),
    );
    assert.equal(
      calls[1].url,
      "https://vcfa.example.test/vco/api/configurations/configuration-1",
    );
    assert.equal(calls[1].init.method, "GET");
  } finally {
    await rm(configurationDir, { recursive: true, force: true });
  }
});

test("listResources parses singular resource attributes", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({
      total: 1,
      link: [
        {
          href: "https://vcfa.example.test/vco/api/resources/resource-1",
          attribute: [
            { name: "id", value: "resource-1" },
            { name: "name", value: "logo.png" },
            { name: "categoryName", value: "Branding" },
            { name: "mimeType", value: "image/png" },
          ],
        },
      ],
    });
  };

  const client = new VroClient(config());
  const resources = await client.listResources("logo");

  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/resources?conditions=name~logo",
  );
  assert.deepEqual(resources.link, [
    {
      id: "resource-1",
      name: "logo.png",
      description: undefined,
      version: undefined,
      categoryId: undefined,
      categoryName: "Branding",
      mimeType: "image/png",
      href: "https://vcfa.example.test/vco/api/resources/resource-1",
    },
  ]);
});

test("resource import rejects path traversal before network calls", async () => {
  const resourceDir = await mkdtemp(join(tmpdir(), "vcfa-resources-"));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return authResponse();
  };

  try {
    const client = new VroClient(config({ resourceDir }));
    await assert.rejects(
      () => client.importResource("category-1", "../secret.txt"),
      /must not contain path separators/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(resourceDir, { recursive: true, force: true });
  }
});

test("resource export rejects existing files unless overwrite is true", async () => {
  const resourceDir = await mkdtemp(join(tmpdir(), "vcfa-resources-"));
  await writeFile(join(resourceDir, "existing.txt"), "old");
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return authResponse();
  };

  try {
    const client = new VroClient(config({ resourceDir }));
    await assert.rejects(
      () => client.exportResource("resource-1", "existing.txt"),
      /already exists/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(resourceDir, { recursive: true, force: true });
  }
});

test("resource import sends multipart file and category id", async () => {
  const resourceDir = await mkdtemp(join(tmpdir(), "vcfa-resources-"));
  await writeFile(join(resourceDir, "payload.txt"), "hello");
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("", { status: 202 });
  };

  try {
    const client = new VroClient(config({ resourceDir }));
    await client.importResource("category-1", "payload.txt");

    assert.equal(calls[1].url, "https://vcfa.example.test/vco/api/resources");
    assert.equal(calls[1].init.method, "POST");
    assert.equal(calls[1].init.headers["Content-Type"], undefined);
    const body = calls[1].init.body;
    assert.equal(body.get("categoryId"), "category-1");
    assert.equal(body.get("file").name, "payload.txt");
  } finally {
    await rm(resourceDir, { recursive: true, force: true });
  }
});

test("deleteResource includes force query only when requested", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response(null, { status: 204 });
  };

  const client = new VroClient(config());
  await client.deleteResource("resource-1", true);

  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/resources/resource-1?force=true",
  );
  assert.equal(calls[1].init.method, "DELETE");
});

test("listWorkflowExecutions ignores non-execution relation links", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({
      relations: {
        total: 1,
        link: [
          { href: "https://vcfa.example.test/vco/api/workflows/wf", rel: "up" },
          {
            href: "https://vcfa.example.test/vco/api/workflows/wf/executions",
            rel: "add",
          },
          {
            href: "https://vcfa.example.test/vco/api/workflows/wf/executions/execution-1",
            rel: "down",
            attributes: [
              { name: "id", value: "execution-1" },
              { name: "state", value: "completed" },
              { name: "startDate", value: "2026-04-28T07:24:10.429Z" },
              { name: "endDate", value: "2026-04-28T07:24:11.701Z" },
              { name: "startedBy", value: "admin" },
            ],
          },
        ],
      },
    });
  };

  const client = new VroClient(config());
  const executions = await client.listWorkflowExecutions("workflow-1", {
    maxResults: 100,
  });

  assert.equal(executions.total, 1);
  assert.deepEqual(executions.relations.link, [
    {
      id: "execution-1",
      state: "completed",
      "start-date": "2026-04-28T07:24:10.429Z",
      "end-date": "2026-04-28T07:24:11.701Z",
      "started-by": "admin",
    },
  ]);
});

test("listDeploymentActions calls deployment actions endpoint", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({
      content: [{ id: "Deployment.PowerOff", name: "Power Off" }],
      totalElements: 1,
    });
  };

  const client = new VroClient(config());
  const actions = await client.listDeploymentActions("dep 1/2");

  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/deployment/api/deployments/dep%201%2F2/actions",
  );
  assert.equal(calls[1].init.method, "GET");
  assert.deepEqual(actions.content, [
    { id: "Deployment.PowerOff", name: "Power Off" },
  ]);
});

test("runDeploymentAction posts action request with optional fields", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({
      id: "request-1",
      deploymentId: "dep 1/2",
      actionId: "Deployment.PowerOff",
      status: "INPROGRESS",
    });
  };

  const client = new VroClient(config());
  const request = await client.runDeploymentAction({
    deploymentId: "dep 1/2",
    actionId: "Deployment.PowerOff",
    reason: "Maintenance",
    inputs: { force: true },
  });

  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/deployment/api/deployments/dep%201%2F2/requests",
  );
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    actionId: "Deployment.PowerOff",
    reason: "Maintenance",
    inputs: { force: true },
  });
  assert.equal(request.id, "request-1");
  assert.equal(request.status, "INPROGRESS");
});

test("runDeploymentAction omits absent optional fields", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({ id: "request-1" });
  };

  const client = new VroClient(config());
  await client.runDeploymentAction({
    deploymentId: "deployment-1",
    actionId: "Deployment.Reboot",
  });

  assert.deepEqual(JSON.parse(calls[1].init.body), {
    actionId: "Deployment.Reboot",
  });
});
