import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
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

test("bodyless 202 responses with Location return an execution id", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("", {
      status: 202,
      headers: { location: "https://vcfa.example.test/vco/api/workflows/wf/executions/execution-123" },
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
    "https://vcfa.example.test/vco/api/workflows/workflow%201/executions/exec%2F1?showDetails=true"
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
    { maxResult: 3 }
  );

  assert.equal(logs.logs[0]["short-description"], "hello");
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/workflows/workflow-1/executions/execution-1/logs?maxResult=3"
  );
  assert.equal(calls[1].init.method, "GET");
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
      /must not contain path separators/
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
      /already exists/
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
      /must not be a symbolic link/
    );
  } finally {
    await rm(packageDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
});

test("package import sends multipart file and overwrite query", async () => {
  const packageDir = await mkdtemp(join(tmpdir(), "vcfa-packages-"));
  await writeFile(join(packageDir, "payload.package"), "package");
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
      "https://vcfa.example.test/vco/api/packages?overwrite=false"
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
    "https://vcfa.example.test/vco/api/packages/com.example?option=deletePackageWithContent"
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
      /must not contain path separators/
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
      /already exists/
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
      /must not be a symbolic link/
    );
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
});

test("workflow import sends multipart file with category and overwrite query", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-workflows-"));
  await writeFile(join(workflowDir, "payload.workflow"), "workflow");
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
      "https://vcfa.example.test/vco/api/workflows?categoryId=category-1&overwrite=false"
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
      "saved.workflow"
    );

    assert.equal(savedPath, join(await realpath(workflowDir), "saved.workflow"));
    assert.equal(
      calls[1].url,
      "https://vcfa.example.test/vco/api/content/workflows/workflow-1"
    );
    assert.equal(calls[1].init.method, "GET");
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
      /must not contain path separators/
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
      /already exists/
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
      /must not be a symbolic link/
    );
  } finally {
    await rm(actionDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
});

test("action import sends multipart file and category name", async () => {
  const actionDir = await mkdtemp(join(tmpdir(), "vcfa-actions-"));
  await writeFile(join(actionDir, "payload.action"), "action");
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
    "https://vcfa.example.test/vco/api/actions/com.example.actions/getVmIp"
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
    "https://vcfa.example.test/vco/api/actions/com.example.actions/getVmIp"
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
    const savedPath = await client.exportActionFile(
      "action-1",
      "saved.action"
    );

    assert.equal(savedPath, join(await realpath(actionDir), "saved.action"));
    assert.equal(
      calls[1].url,
      "https://vcfa.example.test/vco/api/actions/action-1"
    );
    assert.equal(calls[1].init.method, "GET");
  } finally {
    await rm(actionDir, { recursive: true, force: true });
  }
});

test("configuration import rejects path traversal before network calls", async () => {
  const configurationDir = await mkdtemp(join(tmpdir(), "vcfa-configurations-"));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return authResponse();
  };

  try {
    const client = new VroClient(config({ configurationDir }));
    await assert.rejects(
      () => client.importConfigurationFile("category-1", "../secret.vsoconf"),
      /must not contain path separators/
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(configurationDir, { recursive: true, force: true });
  }
});

test("configuration export rejects existing files unless overwrite is true", async () => {
  const configurationDir = await mkdtemp(join(tmpdir(), "vcfa-configurations-"));
  await writeFile(join(configurationDir, "existing.vsoconf"), "old");
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return authResponse();
  };

  try {
    const client = new VroClient(config({ configurationDir }));
    await assert.rejects(
      () => client.exportConfigurationFile("configuration-1", "existing.vsoconf"),
      /already exists/
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(configurationDir, { recursive: true, force: true });
  }
});

test("configuration import rejects symbolic links", async () => {
  const configurationDir = await mkdtemp(join(tmpdir(), "vcfa-configurations-"));
  const outsideFile = join(tmpdir(), `outside-${Date.now()}.vsoconf`);
  await writeFile(outsideFile, "configuration");
  await symlink(outsideFile, join(configurationDir, "linked.vsoconf"));

  try {
    const client = new VroClient(config({ configurationDir }));
    await assert.rejects(
      () => client.importConfigurationFile("category-1", "linked.vsoconf"),
      /must not be a symbolic link/
    );
  } finally {
    await rm(configurationDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
});

test("configuration import sends multipart file and category id", async () => {
  const configurationDir = await mkdtemp(join(tmpdir(), "vcfa-configurations-"));
  await writeFile(join(configurationDir, "payload.vsoconf"), "configuration");
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("", { status: 202 });
  };

  try {
    const client = new VroClient(config({ configurationDir }));
    await client.importConfigurationFile("category-1", "payload.vsoconf");

    assert.equal(calls[1].url, "https://vcfa.example.test/vco/api/configurations");
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
  const configurationDir = await mkdtemp(join(tmpdir(), "vcfa-configurations-"));
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
      "saved.vsoconf"
    );

    assert.equal(savedPath, join(await realpath(configurationDir), "saved.vsoconf"));
    assert.equal(
      calls[1].url,
      "https://vcfa.example.test/vco/api/configurations/configuration-1"
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

  assert.equal(calls[1].url, "https://vcfa.example.test/vco/api/resources?conditions=name~logo");
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
      /must not contain path separators/
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
      /already exists/
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

  assert.equal(calls[1].url, "https://vcfa.example.test/vco/api/resources/resource-1?force=true");
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
          { href: "https://vcfa.example.test/vco/api/workflows/wf/executions", rel: "add" },
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
    "https://vcfa.example.test/deployment/api/deployments/dep%201%2F2/actions"
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
    "https://vcfa.example.test/deployment/api/deployments/dep%201%2F2/requests"
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
