import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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
