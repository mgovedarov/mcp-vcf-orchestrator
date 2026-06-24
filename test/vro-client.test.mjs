import { zipSync } from "fflate";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildWorkflowArtifact } from "../dist/client/workflow-artifact.js";
import {
  normalizeTargetPlatformInput,
  sanitizeErrorBody,
  VroHttpClient,
} from "../dist/client/core.js";
import { formatQuery } from "../dist/client/pagination.js";
import {
  toVroParameters,
  toVroParameterValue,
} from "../dist/client/parameters.js";
import { VroClient } from "../dist/vro-client.js";

const config = (overrides = {}) => ({
  host: "vcfa.example.test",
  username: "admin",
  organization: "org",
  password: "secret",
  // Pin the Cloud API version so authentication skips the GET /api/versions
  // discovery probe; version negotiation has dedicated tests below.
  targetPlatform: "vcfa9.0",
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
  assert.equal(
    client.getExecutionLogDirectory(),
    join(root, "execution-logs"),
  );
  assert.equal(client.getActionDirectory(), join(root, "actions"));
  assert.equal(
    client.getConfigurationDirectory(),
    join(root, "configurations"),
  );
  assert.equal(client.getContextDirectory(), join(root, "context"));
});

test("artifactDir config derives artifact type subdirectories", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "vcfa-artifacts-"));

  try {
    const client = new VroClient(config({ artifactDir }));

    assert.equal(client.getPackageDirectory(), join(artifactDir, "packages"));
    assert.equal(client.getResourceDirectory(), join(artifactDir, "resources"));
    assert.equal(client.getWorkflowDirectory(), join(artifactDir, "workflows"));
    assert.equal(
      client.getExecutionLogDirectory(),
      join(artifactDir, "execution-logs"),
    );
    assert.equal(client.getActionDirectory(), join(artifactDir, "actions"));
    assert.equal(
      client.getConfigurationDirectory(),
      join(artifactDir, "configurations"),
    );
    assert.equal(client.getContextDirectory(), join(artifactDir, "context"));
  } finally {
    await rm(artifactDir, { recursive: true, force: true });
  }
});

test("specific artifact directories override artifactDir", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "vcfa-artifacts-"));
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-workflows-"));
  const executionLogDir = await mkdtemp(join(tmpdir(), "vcfa-execution-logs-"));
  const contextDir = await mkdtemp(join(tmpdir(), "vcfa-context-"));

  try {
    const client = new VroClient(
      config({ artifactDir, workflowDir, executionLogDir, contextDir }),
    );

    assert.equal(client.getWorkflowDirectory(), workflowDir);
    assert.equal(client.getExecutionLogDirectory(), executionLogDir);
    assert.equal(client.getContextDirectory(), contextDir);
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
    await rm(executionLogDir, { recursive: true, force: true });
    await rm(contextDir, { recursive: true, force: true });
  }
});

test("default vcfa platform authenticates with Cloud API session token", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({ link: [], total: 0 });
  };

  const client = new VroClient(config());
  await client.listWorkflows();

  assert.equal(
    calls[0].url,
    "https://vcfa.example.test/cloudapi/1.0.0/sessions",
  );
  assert.equal(calls[0].init.headers.Authorization, "Basic YWRtaW5Ab3JnOnNlY3JldA==");
  assert.equal(calls[1].init.headers.Authorization, "Bearer token");
});

test("vra8 platform uses Basic auth directly against vRO APIs", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      link: [
        {
          attributes: [
            { name: "id", value: "workflow-1" },
            { name: "name", value: "Workflow" },
          ],
        },
      ],
      total: 1,
    });
  };

  const client = new VroClient(config({ targetPlatform: "vra8" }));
  const workflows = await client.listWorkflows();

  assert.equal(workflows.link[0].id, "workflow-1");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://vcfa.example.test/vco/api/workflows?maxResult=100&startIndex=0&queryCount=true",
  );
  assert.equal(calls[0].init.headers.Authorization, "Basic YWRtaW5Ab3JnOnNlY3JldA==");
});

test("vRO list clients aggregate multiple startIndex pages and preserve filters", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();

    const requestUrl = new URL(String(url));
    const startIndex = Number(requestUrl.searchParams.get("startIndex"));
    const count = startIndex === 0 ? 100 : 1;
    return Response.json({
      start: startIndex,
      total: 101,
      link: Array.from({ length: count }, (_, index) => ({
        attributes: [
          { name: "id", value: `action-${startIndex + index}` },
          { name: "name", value: `Action ${startIndex + index}` },
          { name: "module", value: "com.example" },
        ],
      })),
    });
  };

  const client = new VroClient(config());
  const configs = await client.listConfigurations("deploy vm");

  assert.equal(configs.total, 101);
  assert.equal(configs.link.length, 101);
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/configurations?conditions=name~deploy%20vm&maxResult=100&startIndex=0&queryCount=true",
  );
  assert.equal(
    calls[2].url,
    "https://vcfa.example.test/vco/api/configurations?conditions=name~deploy%20vm&maxResult=100&startIndex=100&queryCount=true",
  );
});

test("listActions ignores the server-side filter and filters by name client-side", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    const startIndex = Number(
      new URL(String(url)).searchParams.get("startIndex"),
    );
    const count = startIndex === 0 ? 100 : 1;
    return Response.json({
      start: startIndex,
      total: 101,
      link: Array.from({ length: count }, (_, index) => ({
        attributes: [
          { name: "id", value: `action-${startIndex + index}` },
          { name: "name", value: `Action ${startIndex + index}` },
          { name: "module", value: "com.example" },
        ],
      })),
    });
  };

  const client = new VroClient(config());

  // No filter: aggregates all pages, and never sends a conditions param (the
  // vRO /actions endpoint ignores it).
  const all = await client.listActions();
  assert.equal(all.link.length, 101);
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/actions?maxResult=100&startIndex=0&queryCount=true",
  );
  assert.ok(!calls[1].url.includes("conditions"));

  // Filter: applied client-side, case-insensitively, against the name.
  const filtered = await client.listActions("action 1");
  assert.ok(filtered.link.length > 0);
  assert.ok(
    filtered.link.every((a) => a.name.toLowerCase().includes("action 1")),
  );
  assert.equal(filtered.total, filtered.link.length);
});

test("listActions derives module from the slash-separated fqn when the list omits module", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes("/login") || String(url).includes("/sessions")) {
      return authResponse();
    }
    // Mirror the real vRO /actions list shape: fqn only, no `module` attribute.
    return Response.json({
      total: 3,
      link: [
        {
          attributes: [
            { name: "id", value: "a1" },
            { name: "name", value: "createSnmpQuery" },
            { name: "fqn", value: "com.vmware.library.snmp/createSnmpQuery" },
          ],
        },
        {
          attributes: [
            { name: "id", value: "a2" },
            { name: "name", value: "probeImport" },
            { name: "fqn", value: "com.evoila.mcptest/probeImport" },
          ],
        },
        {
          // Legacy dotted fqn (no slash) must still strip the trailing name.
          attributes: [
            { name: "id", value: "a3" },
            { name: "name", value: "legacy" },
            { name: "fqn", value: "com.old.module.legacy" },
          ],
        },
      ],
    });
  };

  const client = new VroClient(config());
  const actions = await client.listActions();
  const byId = Object.fromEntries(actions.link.map((a) => [a.id, a.module]));
  assert.equal(byId.a1, "com.vmware.library.snmp");
  assert.equal(byId.a2, "com.evoila.mcptest");
  assert.equal(byId.a3, "com.old.module");
});

test("updateAction sends an empty input-parameters array to clear all parameters", async () => {
  let putBody;
  const current = {
    id: "action-1",
    name: "getVmIp",
    module: "com.example.actions",
    version: "1.0.0",
    script: "return 1;",
    "output-type": "string",
    "input-parameters": [{ name: "vm", type: "VC:VirtualMachine" }],
  };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/login") || u.includes("/sessions")) return authResponse();
    if (init?.method === "PUT") {
      putBody = JSON.parse(String(init.body));
      return Response.json({ errors: [] });
    }
    // Both the initial fetch and the re-fetch return the current action.
    return Response.json(current);
  };

  const client = new VroClient(config());
  await client.updateAction("action-1", { inputParameters: [] });

  assert.deepEqual(putBody["input-parameters"], []);
  // Unspecified fields are preserved from the live action.
  assert.equal(putBody.script, "return 1;");
  assert.equal(putBody["output-type"], "string");
});

test("formatQuery preserves $ and ~ in values while keeping OData $-keys literal", () => {
  assert.equal(
    formatQuery(new URLSearchParams({ $filter: "projectId eq 'a$b~c'" })),
    "$filter=projectId%20eq%20%27a%24b~c%27",
  );
  assert.equal(
    formatQuery(new URLSearchParams({ conditions: "name~cost$center" })),
    "conditions=name~cost%24center",
  );
  assert.equal(
    formatQuery(new URLSearchParams({ conditions: "a&b=c%d+e" })),
    "conditions=a%26b%3Dc%25d%2Be",
  );
});

test("vRO conditions values containing $ are percent-encoded", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({ start: 0, total: 0, link: [] });
  };

  const client = new VroClient(config());
  await client.listConfigurations("cost$center ~v2");

  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/configurations?conditions=name~cost%24center%20~v2&maxResult=100&startIndex=0&queryCount=true",
  );
});

test("$search values containing $ keep the key literal and encode the value", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({ totalElements: 0, content: [] });
  };

  const client = new VroClient(config());
  await client.listCatalogItems("price $100");

  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/catalog/api/items?$search=price%20%24100&page=0&size=100",
  );
});

test("vRO pagination continues after short pages when total reports more results", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();

    const requestUrl = new URL(String(url));
    const startIndex = Number(requestUrl.searchParams.get("startIndex"));
    const count = startIndex === 0 ? 50 : 25;
    return Response.json({
      start: startIndex,
      total: 75,
      link: Array.from({ length: count }, (_, index) => ({
        attributes: [
          { name: "id", value: `workflow-${startIndex + index}` },
          { name: "name", value: `Workflow ${startIndex + index}` },
        ],
      })),
    });
  };

  const client = new VroClient(config());
  const workflows = await client.listWorkflows();

  assert.equal(workflows.total, 75);
  assert.equal(workflows.link.length, 75);
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/workflows?maxResult=100&startIndex=0&queryCount=true",
  );
  assert.equal(
    calls[2].url,
    "https://vcfa.example.test/vco/api/workflows?maxResult=100&startIndex=50&queryCount=true",
  );
});

test("listWorkflows keeps page size 100 while collecting inventories over 600 items", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();

    const requestUrl = new URL(String(url));
    const startIndex = Number(requestUrl.searchParams.get("startIndex"));
    const maxResult = Number(requestUrl.searchParams.get("maxResult"));
    const queryCount = requestUrl.searchParams.get("queryCount");
    const total = queryCount === "true" ? 625 : 100;
    const count = Math.max(0, Math.min(maxResult, total - startIndex));
    return Response.json({
      start: 0,
      total,
      link: Array.from({ length: count }, (_, index) => ({
        attributes: [
          { name: "id", value: `workflow-${startIndex + index}` },
          { name: "name", value: `Workflow ${startIndex + index}` },
        ],
      })),
    });
  };

  const client = new VroClient(config());
  const workflows = await client.listWorkflows();

  assert.equal(workflows.total, 625);
  assert.equal(workflows.link.length, 625);
  assert.equal(calls.length, 8);

  const pageUrls = calls.slice(1).map((call) => new URL(call.url));
  assert.deepEqual(
    pageUrls.map((url) => url.searchParams.get("startIndex")),
    ["0", "100", "200", "300", "400", "500", "600"],
  );
  assert.ok(
    pageUrls.every(
      (url) =>
        url.searchParams.get("maxResult") === "100" &&
        url.searchParams.get("queryCount") === "true",
    ),
  );
});

test("listWorkflows falls back when vRO rejects queryCount", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();

    const requestUrl = new URL(String(url));
    if (requestUrl.searchParams.get("queryCount") === "true") {
      return Response.json(
        {
          message:
            "isQueryCount is not implemented for the type.",
        },
        { status: 400, statusText: "Bad Request" },
      );
    }

    const startIndex = Number(requestUrl.searchParams.get("startIndex"));
    const maxResult = Number(requestUrl.searchParams.get("maxResult"));
    const total = 625;
    const count = Math.max(0, Math.min(maxResult, total - startIndex));
    return Response.json({
      start: 0,
      total: 100,
      link: Array.from({ length: count }, (_, index) => ({
        attributes: [
          { name: "id", value: `workflow-${startIndex + index}` },
          { name: "name", value: `Workflow ${startIndex + index}` },
        ],
      })),
    });
  };

  const client = new VroClient(config());
  const workflows = await client.listWorkflows();

  assert.equal(workflows.total, 625);
  assert.equal(workflows.link.length, 625);

  const pageUrls = calls.slice(2).map((call) => new URL(call.url));
  assert.deepEqual(
    pageUrls.map((url) => url.searchParams.get("startIndex")),
    ["0", "100", "200", "300", "400", "500", "600"],
  );
  assert.ok(
    pageUrls.every(
      (url) =>
        url.searchParams.get("maxResult") === "100" &&
        url.searchParams.get("queryCount") === null,
    ),
  );
});

test("listWorkflows falls back to categories when workflow pages repeat", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();

    const requestUrl = new URL(String(url));
    if (requestUrl.pathname.endsWith("/workflows")) {
      if (requestUrl.searchParams.get("queryCount") === "true") {
        return Response.json(
          { message: "isQueryCount is not implemented for the type." },
          { status: 400, statusText: "Bad Request" },
        );
      }
      return Response.json({
        start: 0,
        total: 100,
        link: Array.from({ length: 100 }, (_, index) => ({
          attributes: [
            { name: "id", value: `repeated-${index}` },
            { name: "name", value: `Repeated ${index}` },
          ],
        })),
      });
    }

    if (requestUrl.pathname.endsWith("/categories")) {
      return Response.json({
        total: 1,
        link: [
          {
            attributes: [
              { name: "id", value: "root" },
              { name: "name", value: "Root" },
              { name: "type", value: "WorkflowCategory" },
            ],
          },
        ],
      });
    }

    if (requestUrl.pathname.endsWith("/categories/root")) {
      return Response.json({
        id: "root",
        name: "Root",
        type: "WorkflowCategory",
        relations: {
          link: [
            {
              rel: "down",
              attributes: [
                { name: "type", value: "Workflow" },
                { name: "id", value: "workflow-1" },
                { name: "name", value: "Workflow One" },
              ],
            },
            {
              rel: "down",
              attributes: [
                { name: "type", value: "Workflow" },
                { name: "id", value: "workflow-2" },
                { name: "name", value: "Workflow Two" },
              ],
            },
          ],
        },
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const client = new VroClient(config());
  const workflows = await client.listWorkflows();

  assert.equal(workflows.total, 2);
  assert.deepEqual(
    workflows.link.map((workflow) => workflow.id),
    ["workflow-1", "workflow-2"],
  );
});

test("listWorkflows falls back to categories when counted workflow pages repeat", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();

    const requestUrl = new URL(String(url));
    if (requestUrl.pathname.endsWith("/workflows")) {
      return Response.json({
        start: 0,
        total: 250,
        link: Array.from({ length: 100 }, (_, index) => ({
          attributes: [
            { name: "id", value: `repeated-${index}` },
            { name: "name", value: `Repeated ${index}` },
          ],
        })),
      });
    }

    if (requestUrl.pathname.endsWith("/categories")) {
      return Response.json({
        total: 1,
        link: [
          {
            attributes: [
              { name: "id", value: "root" },
              { name: "name", value: "Root" },
              { name: "type", value: "WorkflowCategory" },
            ],
          },
        ],
      });
    }

    if (requestUrl.pathname.endsWith("/categories/root")) {
      return Response.json({
        id: "root",
        name: "Root",
        type: "WorkflowCategory",
        relations: {
          link: [
            {
              rel: "down",
              attributes: [
                { name: "type", value: "Workflow" },
                { name: "id", value: "workflow-1" },
                { name: "name", value: "Workflow One" },
              ],
            },
          ],
        },
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const client = new VroClient(config());
  const workflows = await client.listWorkflows();

  assert.equal(workflows.total, 1);
  assert.deepEqual(
    workflows.link.map((workflow) => workflow.id),
    ["workflow-1"],
  );
});

test("vra8 platform paginates vRO lists with Basic auth", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const requestUrl = new URL(String(url));
    const startIndex = Number(requestUrl.searchParams.get("startIndex"));
    return Response.json({
      start: startIndex,
      total: 101,
      link: Array.from({ length: startIndex === 0 ? 100 : 1 }, (_, index) => ({
        attributes: [
          { name: "id", value: `workflow-${startIndex + index}` },
          { name: "name", value: `Workflow ${startIndex + index}` },
        ],
      })),
    });
  };

  const client = new VroClient(config({ targetPlatform: "vra8" }));
  const workflows = await client.listWorkflows();

  assert.equal(workflows.link.length, 101);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.Authorization, "Basic YWRtaW5Ab3JnOnNlY3JldA==");
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/workflows?maxResult=100&startIndex=100&queryCount=true",
  );
});

test("client rejects invalid target platform values", () => {
  assert.throws(
    () => new VroClient(config({ targetPlatform: "vro8" })),
    /targetPlatform must be one of: vcfa, vcfa9\.0, vcfa9\.1, vra8/,
  );
});

// ─── VCF Cloud API version negotiation and login routing (VCFO-057) ─────────

const versionsXml = (versions) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<SupportedVersions xmlns="http://www.vmware.com/vcloud/versions">
${versions
  .map(
    (v) => `    <VersionInfo deprecated="false">
        <Version>${v}</Version>
        <LoginUrl>https://vcfa.example.test/cloudapi/1.0.0/sessions</LoginUrl>
    </VersionInfo>`,
  )
  .join("\n")}
</SupportedVersions>`;

test("vcfa auto-negotiation prefers API version 9.1.0 from GET /api/versions", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/api/versions")) {
      return new Response(versionsXml(["40.0", "9.0.0", "9.1.0"]), {
        status: 200,
      });
    }
    if (String(url).includes("/cloudapi/1.0.0/sessions")) return authResponse();
    return Response.json({ link: [], total: 0 });
  };

  const client = new VroClient(config({ targetPlatform: "vcfa" }));
  await client.listWorkflows();

  assert.equal(calls[0].url, "https://vcfa.example.test/api/versions");
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/cloudapi/1.0.0/sessions",
  );
  assert.equal(
    calls[1].init.headers.Accept,
    "application/json;version=9.1.0",
  );
  assert.equal(
    calls[1].init.headers["Content-Type"],
    "application/json;version=9.1.0",
  );
  const probes = calls.filter((c) => c.url.endsWith("/api/versions"));
  assert.equal(probes.length, 1, "discovery probe should run exactly once");
});

test("vcfa auto-negotiation falls back to 9.0.0 when no known version is advertised", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/api/versions")) {
      return new Response(versionsXml(["8.7.0"]), { status: 200 });
    }
    if (String(url).includes("/cloudapi/1.0.0/sessions")) return authResponse();
    return Response.json({ link: [], total: 0 });
  };

  const client = new VroClient(config({ targetPlatform: "vcfa" }));
  await client.listWorkflows();

  assert.equal(
    calls[1].init.headers.Accept,
    "application/json;version=9.0.0",
  );
});

test("vcfa auto-negotiation falls back to 9.0.0 when the discovery probe fails", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/api/versions")) {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    if (String(url).includes("/cloudapi/1.0.0/sessions")) return authResponse();
    return Response.json({ link: [], total: 0 });
  };

  const client = new VroClient(config({ targetPlatform: "vcfa" }));
  await client.listWorkflows();

  assert.equal(
    calls[1].init.headers.Accept,
    "application/json;version=9.0.0",
  );
});

test("a failed discovery probe is retried on the next authentication", async () => {
  let probeCount = 0;
  const sessionVersions = [];
  let workflowCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/api/versions")) {
      probeCount += 1;
      if (probeCount === 1) {
        return new Response("boom", {
          status: 503,
          statusText: "Service Unavailable",
        });
      }
      return new Response(versionsXml(["9.1.0", "9.0.0"]), { status: 200 });
    }
    if (String(url).includes("/cloudapi/1.0.0/sessions")) {
      sessionVersions.push(init.headers.Accept);
      return authResponse();
    }
    workflowCalls += 1;
    // First workflow request gets 401 to force a token refresh + re-auth.
    if (workflowCalls === 1) {
      return new Response("", { status: 401, statusText: "Unauthorized" });
    }
    return Response.json({ link: [], total: 0 });
  };

  const client = new VroClient(config({ targetPlatform: "vcfa" }));
  await client.listWorkflows();

  assert.equal(probeCount, 2, "failed probe must be retried on re-auth");
  assert.deepEqual(sessionVersions, [
    "application/json;version=9.0.0",
    "application/json;version=9.1.0",
  ]);
});

test("concurrent first requests share one probe and one session login", async () => {
  let probeCount = 0;
  let sessionCount = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/api/versions")) {
      probeCount += 1;
      return new Response(versionsXml(["9.1.0"]), { status: 200 });
    }
    if (String(url).includes("/cloudapi/1.0.0/sessions")) {
      sessionCount += 1;
      return authResponse();
    }
    return Response.json({ link: [], total: 0 });
  };

  const client = new VroClient(config({ targetPlatform: "vcfa" }));
  await Promise.all([
    client.listWorkflows(),
    client.listWorkflows(),
    client.listWorkflows(),
  ]);

  assert.equal(probeCount, 1, "concurrent requests must share one probe");
  assert.equal(sessionCount, 1, "concurrent requests must share one login");
});

test("normalizeTargetPlatformInput preserves version pins and validates input", () => {
  assert.equal(normalizeTargetPlatformInput(undefined), "vcfa");
  assert.equal(normalizeTargetPlatformInput(""), "vcfa");
  assert.equal(normalizeTargetPlatformInput("VCFA"), "vcfa");
  assert.equal(normalizeTargetPlatformInput("VCFA9.1"), "vcfa9.1");
  assert.equal(normalizeTargetPlatformInput("vcfa9.0"), "vcfa9.0");
  assert.equal(normalizeTargetPlatformInput("vra8"), "vra8");
  assert.throws(
    () => normalizeTargetPlatformInput("vro8"),
    /targetPlatform must be one of: vcfa, vcfa9\.0, vcfa9\.1, vra8/,
  );
});

test("vcfa9.1 pin skips the discovery probe and uses version 9.1.0", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/cloudapi/1.0.0/sessions")) return authResponse();
    return Response.json({ link: [], total: 0 });
  };

  const client = new VroClient(config({ targetPlatform: "vcfa9.1" }));
  await client.listWorkflows();

  assert.equal(
    calls.filter((c) => c.url.endsWith("/api/versions")).length,
    0,
    "pinned version must not probe GET /api/versions",
  );
  assert.equal(
    calls[0].url,
    "https://vcfa.example.test/cloudapi/1.0.0/sessions",
  );
  assert.equal(
    calls[0].init.headers.Accept,
    "application/json;version=9.1.0",
  );
});

test("system organization routes login to the provider sessions endpoint", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/cloudapi/1.0.0/sessions")) return authResponse();
    return Response.json({ link: [], total: 0 });
  };

  const client = new VroClient(config({ organization: "System" }));
  await client.listWorkflows();

  assert.equal(
    calls[0].url,
    "https://vcfa.example.test/cloudapi/1.0.0/sessions/provider",
  );
  assert.equal(
    calls[0].init.headers.Authorization,
    "Basic " + Buffer.from("admin@System:secret").toString("base64"),
  );
});

test("tenant 401 failure hints at org name vs display name and provider logins", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes("/cloudapi/1.0.0/sessions")) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        statusText: "Unauthorized",
      });
    }
    return Response.json({ link: [], total: 0 });
  };

  const client = new VroClient(config());
  await assert.rejects(
    () => client.listWorkflows(),
    /organization name \(the tenant URL slug\), not its display name[\s\S]*VCFA_ORGANIZATION=system/,
  );
});

test("provider 401 failure hints at provider account verification", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes("/cloudapi/1.0.0/sessions")) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        statusText: "Unauthorized",
      });
    }
    return Response.json({ link: [], total: 0 });
  };

  const client = new VroClient(config({ organization: "system" }));
  await assert.rejects(
    () => client.listWorkflows(),
    /provider logins use the system organization/,
  );
});

test("vra8 platform rejects Automation-service APIs with clear message", async () => {
  const client = new VroClient(config({ targetPlatform: "vra8" }));

  await assert.rejects(
    () => client.listTemplates(),
    /Automation-service APIs .* not supported .*vra8 Basic-auth mode/,
  );
  await assert.rejects(
    () => client.listDeployments(),
    /Automation-service APIs .* not supported .*vra8 Basic-auth mode/,
  );
  await assert.rejects(
    () => client.listCatalogItems(),
    /Automation-service APIs .* not supported .*vra8 Basic-auth mode/,
  );
  await assert.rejects(
    () => client.listSubscriptions(),
    /Automation-service APIs .* not supported .*vra8 Basic-auth mode/,
  );
});

test("vra8 platform rejects vRO writes other than workflow execution", async () => {
  const client = new VroClient(config({ targetPlatform: "vra8" }));

  await assert.rejects(
    () => client.createWorkflow("category-1", "Workflow"),
    /read operations plus workflow execution and execution logs only/,
  );
});

test("vra8 platform rejects artifact imports before local file checks", async () => {
  const client = new VroClient(config({ targetPlatform: "vra8" }));
  const expected = /read operations plus workflow execution and execution logs only/;

  await assert.rejects(
    () => client.importWorkflowFile("category-1", "missing.workflow"),
    expected,
  );
  await assert.rejects(
    () => client.importActionFile("category-name", "missing.action"),
    expected,
  );
  await assert.rejects(
    () => client.importConfigurationFile("category-1", "missing.vsoconf"),
    expected,
  );
  await assert.rejects(
    () => client.importPackage("missing.package"),
    expected,
  );
  await assert.rejects(
    () => client.getPackageImportDetails("missing.package"),
    expected,
  );
  await assert.rejects(
    () => client.importResource("category-1", "missing.bin"),
    expected,
  );
  await assert.rejects(
    () => client.updateResourceContent("resource-1", "missing.bin"),
    expected,
  );
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

test("runWorkflow keys execution input values by the canonical vRO type literal", async () => {
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
  await client.runWorkflow("workflow-1", [
    { name: "username", type: "string", value: "admin" },
    { name: "password", type: "SecureString", value: "s3cret" },
    { name: "expiry", type: "Date", value: "2026-06-12T00:00:00Z" },
  ]);

  const body = JSON.parse(calls[1].init.body);
  assert.deepEqual(body.parameters, [
    {
      name: "username",
      type: "string",
      value: { string: { value: "admin" } },
    },
    {
      name: "password",
      type: "SecureString",
      value: { "secure-string": { value: "s3cret" } },
    },
    {
      name: "expiry",
      type: "Date",
      value: { date: { value: "2026-06-12T00:00:00Z" } },
    },
  ]);
});

test("toVroParameterValue maps display types to canonical value keys and shapes", () => {
  assert.deepEqual(toVroParameterValue("SecureString", "s3cret"), {
    "secure-string": { value: "s3cret" },
  });
  assert.deepEqual(toVroParameterValue("MimeAttachment", "data"), {
    "mime-attachment": { value: "data" },
  });
  assert.deepEqual(toVroParameterValue("number", 7), {
    number: { value: 7 },
  });
  assert.deepEqual(toVroParameterValue("Array/SecureString", ["a", "b"]), {
    array: {
      elements: [
        { "secure-string": { value: "a" } },
        { "secure-string": { value: "b" } },
      ],
    },
  });
  assert.deepEqual(toVroParameterValue("VC:VirtualMachine", "vm-123"), {
    "sdk-object": { id: "vm-123", type: "VC:VirtualMachine" },
  });
  assert.deepEqual(toVroParameterValue("Array/VC:VirtualMachine", ["vm-1"]), {
    array: {
      elements: [
        { "sdk-object": { id: "vm-1", type: "VC:VirtualMachine" } },
      ],
    },
  });
  assert.deepEqual(
    toVroParameterValue("CompositeType(name:string,count:number):Pair", {
      type: "CompositeType(name:string,count:number):Pair",
      field: [{ name: "name", value: { string: { value: "a" } } }],
    }),
    {
      composite: {
        type: "CompositeType(name:string,count:number):Pair",
        field: [{ name: "name", value: { string: { value: "a" } } }],
      },
    },
  );
  assert.deepEqual(
    toVroParameterValue("Properties", { color: "blue", count: 2 }),
    {
      properties: {
        property: [
          { key: "color", value: { string: { value: "blue" } } },
          { key: "count", value: { number: { value: 2 } } },
        ],
      },
    },
  );
});

test("toVroParameterValue rejects non-object Properties and Composite values", () => {
  assert.throws(
    () => toVroParameterValue("Properties", "not-an-object"),
    /Properties parameter .* expects an object of key\/value pairs, received string/,
  );
  assert.throws(
    () => toVroParameterValue("Properties", ["a", "b"]),
    /received array/,
  );
  assert.throws(
    () => toVroParameterValue("Properties", null),
    /received null/,
  );
  assert.throws(
    () => toVroParameterValue("CompositeType(name:string):Pair", 42),
    /Composite parameter .* expects an object, received number/,
  );
});

test("toVroParameters omits the value wrapper for parameters without a value", () => {
  assert.deepEqual(
    toVroParameters([
      { name: "password", type: "SecureString", value: "s3cret" },
      { name: "optional", type: "string" },
    ]),
    [
      {
        name: "password",
        type: "SecureString",
        value: { "secure-string": { value: "s3cret" } },
      },
      { name: "optional", type: "string", value: undefined },
    ],
  );
});

test("generic bodyless 2xx responses with a Location header do not synthesize an execution", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("", {
      status: 202,
      headers: {
        location: "https://vcfa.example.test/vco/api/things/thing-9",
      },
    });
  };

  const http = new VroHttpClient(config());
  const result = await http.post("/things/thing-9/promote");

  assert.deepEqual(result, {});
  assert.equal(result.state, undefined);
  assert.equal(calls.length, 2);
});

test("non-JSON 2xx responses throw a contextualized error", async () => {
  const htmlBody = "<html><body>Maintenance</body></html>" + "x".repeat(300);
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/sessions")) return authResponse();
    return new Response(htmlBody, {
      status: 200,
      headers: { "content-type": "text/html", "x-request-id": "req-42" },
    });
  };

  const client = new VroClient(config());
  await assert.rejects(
    () => client.getWorkflow("workflow-1"),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /non-JSON response body \(200/);
      assert.match(error.message, /GET \/workflows\/workflow-1/);
      assert.match(error.message, /x-request-id: req-42/);
      assert.ok(error.message.includes("…"), "excerpt should be truncated");
      assert.ok(
        !error.message.includes("x".repeat(250)),
        "raw body tail must not leak into the error",
      );
      return true;
    },
  );
});

test("whitespace-only 2xx responses throw a contextualized error", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes("/sessions")) return authResponse();
    return new Response("   ", { status: 200 });
  };

  const client = new VroClient(config());
  await assert.rejects(
    () => client.getWorkflow("workflow-1"),
    /non-JSON response body .*GET \/workflows\/workflow-1/s,
  );
});

test("startExecution parses a JSON 2xx body", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({ id: "execution-9", state: "completed" });
  };

  const http = new VroHttpClient(config());
  const execution = await http.startExecution("/workflows/wf-1/executions", {});

  assert.equal(execution.id, "execution-9");
  assert.equal(execution.state, "completed");
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

test("getWorkflowExecutionLogs calls workflow execution syslogs endpoint", async () => {
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
    "https://vcfa.example.test/vco/api/workflows/workflow-1/executions/execution-1/syslogs?maxResult=3",
  );
  assert.equal(calls[1].init.method, "GET");
});

test("getWorkflowExecutionLogs normalizes alternate vRO log entry shapes", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({
      logs: [
        {
          attributes: [
            { name: "severity", value: "INFO" },
            { name: "timeStamp", value: "2026-05-13T07:15:45Z" },
            { name: "message", value: "hello from attributes" },
          ],
        },
        {
          log: {
            level: "ERROR",
            timestamp: "2026-05-13T07:15:46Z",
            msg: "nested failure",
          },
        },
      ],
    });
  };

  const client = new VroClient(config());
  const result = await client.getWorkflowExecutionLogs(
    "workflow-1",
    "execution-1",
  );

  assert.deepEqual(
    result.logs.map((log) => ({
      severity: log.severity,
      timestamp: log["time-stamp"],
      description: log["short-description"],
    })),
    [
      {
        severity: "INFO",
        timestamp: "2026-05-13T07:15:45Z",
        description: "hello from attributes",
      },
      {
        severity: "ERROR",
        timestamp: "2026-05-13T07:15:46Z",
        description: "nested failure",
      },
    ],
  );
});

test("exportWorkflowExecutionLogs writes JSON with info minimum level by default", async () => {
  const executionLogDir = await mkdtemp(join(tmpdir(), "vcfa-execution-logs-"));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({
      logs: [
        { severity: "DEBUG", "short-description": "debug detail" },
        { severity: "INFO", "short-description": "started" },
        { severity: "WARNING", "short-description": "careful" },
        { severity: "ERROR", "short-description": "failed" },
        { severity: "TRACE", "short-description": "unknown" },
      ],
    });
  };

  try {
    const client = new VroClient(config({ executionLogDir }));
    const result = await client.exportWorkflowExecutionLogs({
      workflowId: "workflow-1",
      executionId: "execution-1",
      fileName: "execution-1.json",
      maxResult: 5,
    });
    const exported = JSON.parse(await readFile(result.path, "utf8"));

    assert.equal(result.level, "info");
    assert.equal(result.format, "json");
    assert.equal(result.fetchedCount, 5);
    assert.equal(result.exportedCount, 3);
    assert.equal(exported.metadata.workflowId, "workflow-1");
    assert.equal(exported.metadata.executionId, "execution-1");
    assert.deepEqual(
      exported.logs.map((log) => log["short-description"]),
      ["started", "careful", "failed"],
    );
    assert.equal(
      calls[1].url,
      "https://vcfa.example.test/vco/api/workflows/workflow-1/executions/execution-1/syslogs?maxResult=5",
    );
  } finally {
    await rm(executionLogDir, { recursive: true, force: true });
  }
});

test("exportWorkflowExecutionLogs writes normalized JSON without raw wrapper fields", async () => {
  const executionLogDir = await mkdtemp(join(tmpdir(), "vcfa-execution-logs-"));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({
      logs: [
        {
          entry: {
            origin: "system",
            "short-description": "nested info",
            "time-stamp": "2026-04-21T10:48:52.172+00:00",
            "time-stamp-val": 1776768532172,
            severity: "info",
          },
        },
      ],
    });
  };

  try {
    const client = new VroClient(config({ executionLogDir }));
    const result = await client.exportWorkflowExecutionLogs({
      workflowId: "workflow-1",
      executionId: "execution-1",
      fileName: "execution-1.json",
      level: "debug",
    });
    const exported = JSON.parse(await readFile(result.path, "utf8"));

    assert.deepEqual(exported.logs, [
      {
        origin: "system",
        "short-description": "nested info",
        "time-stamp": "2026-04-21T10:48:52.172+00:00",
        "time-stamp-val": 1776768532172,
        severity: "info",
      },
    ]);
  } finally {
    await rm(executionLogDir, { recursive: true, force: true });
  }
});

test("exportWorkflowExecutionLogs writes text with debug minimum level", async () => {
  const executionLogDir = await mkdtemp(join(tmpdir(), "vcfa-execution-logs-"));
  const calls = [];
  globalThis.fetch = async (_url, _init) => {
    calls.push({});
    if (calls.length === 1) return authResponse();
    return Response.json({
      logs: [
        {
          severity: "DEBUG",
          origin: "item1",
          "time-stamp": "2026-05-12T10:00:00Z",
          "short-description": "debug detail",
        },
        { severity: "TRACE", "short-description": "unknown detail" },
      ],
    });
  };

  try {
    const client = new VroClient(config({ executionLogDir }));
    const result = await client.exportWorkflowExecutionLogs({
      workflowId: "workflow-1",
      executionId: "execution-1",
      fileName: "execution-1.txt",
      level: "debug",
      format: "text",
    });
    const text = await readFile(result.path, "utf8");

    assert.equal(result.exportedCount, 2);
    assert.match(text, /Minimum level: debug/);
    assert.match(
      text,
      /2026-05-12T10:00:00Z \[DEBUG\] item1 debug detail/,
    );
    assert.match(text, /unknown detail/);
  } finally {
    await rm(executionLogDir, { recursive: true, force: true });
  }
});

test("exportWorkflowExecutionLogs filters error minimum level", async () => {
  const executionLogDir = await mkdtemp(join(tmpdir(), "vcfa-execution-logs-"));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({
      logs: [
        { severity: "INFO", "short-description": "started" },
        { severity: "WARN", "short-description": "warning" },
        { severity: "ERROR", "short-description": "failed" },
      ],
    });
  };

  try {
    const client = new VroClient(config({ executionLogDir }));
    const result = await client.exportWorkflowExecutionLogs({
      workflowId: "workflow-1",
      executionId: "execution-1",
      fileName: "errors.json",
      level: "error",
      format: "json",
    });
    const exported = JSON.parse(await readFile(result.path, "utf8"));

    assert.equal(result.exportedCount, 1);
    assert.deepEqual(
      exported.logs.map((log) => log["short-description"]),
      ["failed"],
    );
  } finally {
    await rm(executionLogDir, { recursive: true, force: true });
  }
});

test("exportWorkflowExecutionLogs validates level, file names, and existing targets before network calls", async () => {
  const executionLogDir = await mkdtemp(join(tmpdir(), "vcfa-execution-logs-"));
  await writeFile(join(executionLogDir, "existing.json"), "{}");
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return authResponse();
  };

  try {
    const client = new VroClient(config({ executionLogDir }));
    const base = {
      workflowId: "workflow-1",
      executionId: "execution-1",
      fileName: "logs.json",
    };

    await assert.rejects(
      () => client.exportWorkflowExecutionLogs({ ...base, level: "trace" }),
      /level must be one of/,
    );
    await assert.rejects(
      () => client.exportWorkflowExecutionLogs({ ...base, fileName: "logs.csv" }),
      /must end with \.json or \.txt/,
    );
    await assert.rejects(
      () => client.exportWorkflowExecutionLogs({ ...base, fileName: "../logs.json" }),
      /must not contain path separators/,
    );
    await assert.rejects(
      () =>
        client.exportWorkflowExecutionLogs({
          ...base,
          fileName: "existing.json",
        }),
      /already exists/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(executionLogDir, { recursive: true, force: true });
  }
});

test("exportWorkflowExecutionLogs rejects symbolic link targets", async () => {
  const executionLogDir = await mkdtemp(join(tmpdir(), "vcfa-execution-logs-"));
  const outsideFile = join(tmpdir(), `execution-logs-${Date.now()}.json`);
  await writeFile(outsideFile, "{}");
  await symlink(outsideFile, join(executionLogDir, "linked.json"));

  try {
    const client = new VroClient(config({ executionLogDir }));
    await assert.rejects(
      () =>
        client.exportWorkflowExecutionLogs({
          workflowId: "workflow-1",
          executionId: "execution-1",
          fileName: "linked.json",
          overwrite: true,
        }),
      /must not be a symbolic link/,
    );
  } finally {
    await rm(executionLogDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
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

    if (
      String(url).endsWith(
        "/catalog/api/items?$search=ubuntu%2022&page=0&size=100",
      )
    ) {
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
    "https://vcfa.example.test/catalog/api/items?$search=ubuntu%2022&page=0&size=100",
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

test("Automation service list clients aggregate multiple page results", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();

    const requestUrl = new URL(String(url));
    const page = Number(requestUrl.searchParams.get("page"));
    const count = page === 0 ? 100 : 1;
    return Response.json({
      content: Array.from({ length: count }, (_, index) => ({
        id: `deployment-${page * 100 + index}`,
        name: `Deployment ${page * 100 + index}`,
      })),
      last: page === 1,
      number: page,
      numberOfElements: count,
      size: 100,
      totalElements: 101,
      totalPages: 2,
    });
  };

  const client = new VroClient(config());
  const deployments = await client.listDeployments("prod vm", "project/1");

  assert.equal(deployments.totalElements, 101);
  assert.equal(deployments.numberOfElements, 101);
  assert.equal(deployments.content.length, 101);
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/deployment/api/deployments?$search=prod%20vm&projectId=project%2F1&page=0&size=100",
  );
  assert.equal(
    calls[2].url,
    "https://vcfa.example.test/deployment/api/deployments?$search=prod%20vm&projectId=project%2F1&page=1&size=100",
  );
});

test("Automation pagination continues after short pages when total reports more results", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();

    const requestUrl = new URL(String(url));
    const page = Number(requestUrl.searchParams.get("page"));
    const count = page === 0 ? 50 : 25;
    return Response.json({
      content: Array.from({ length: count }, (_, index) => ({
        id: `catalog-${page * 50 + index}`,
        name: `Catalog ${page * 50 + index}`,
      })),
      last: page === 1,
      number: page,
      numberOfElements: count,
      size: 50,
      totalElements: 75,
      totalPages: 2,
    });
  };

  const client = new VroClient(config());
  const catalogItems = await client.listCatalogItems();

  assert.equal(catalogItems.totalElements, 75);
  assert.equal(catalogItems.numberOfElements, 75);
  assert.equal(catalogItems.content.length, 75);
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/catalog/api/items?page=0&size=100",
  );
  assert.equal(
    calls[2].url,
    "https://vcfa.example.test/catalog/api/items?page=1&size=100",
  );
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
    "https://vcfa.example.test/blueprint/api/blueprints?$search=small%20vm&projectId=project%2F1&page=0&size=100",
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

    if (String(url).endsWith("/event-broker/api/topics?page=0&size=100")) {
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
    "https://vcfa.example.test/event-broker/api/topics?page=0&size=100",
  );
  assert.equal(
    calls[2].url,
    "https://vcfa.example.test/event-broker/api/subscriptions?$filter=projectId%20eq%20%27project%2F1%27&page=0&size=100",
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
    "https://vcfa.example.test/vco/api/categories?categoryType=WorkflowCategory&conditions=name~Provisioning&maxResult=100&startIndex=0&queryCount=true",
  );
  assert.equal(
    calls[2].url,
    "https://vcfa.example.test/vco/api/plugins?conditions=name~library&maxResult=100&startIndex=0&queryCount=true",
  );
});

test("listConfigurations with categoryId fetches category relations and filters ConfigurationElements", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({
      relations: {
        link: [
          {
            rel: "down",
            href: "https://vcfa.example.test/vco/api/configurations/conf-1",
            attributes: [
              { name: "id", value: "conf-1" },
              { name: "name", value: "Email Configuration" },
              { name: "type", value: "ConfigurationElement" },
              { name: "version", value: "1.2.0" },
            ],
          },
          {
            rel: "down",
            attributes: [
              { name: "id", value: "sub-cat" },
              { name: "name", value: "Sub" },
              { name: "type", value: "ConfigurationElementCategory" },
            ],
          },
          {
            rel: "up",
            attributes: [
              { name: "id", value: "parent-cat" },
              { name: "name", value: "Swisscom" },
              { name: "type", value: "ConfigurationElementCategory" },
            ],
          },
        ],
      },
    });
  };

  const client = new VroClient(config());
  const result = await client.listConfigurations(undefined, "migration-cat");

  assert.equal(result.total, 1);
  assert.deepEqual(result.link, [
    {
      id: "conf-1",
      name: "Email Configuration",
      description: undefined,
      version: "1.2.0",
      categoryId: "migration-cat",
      href: "https://vcfa.example.test/vco/api/configurations/conf-1",
    },
  ]);
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/categories/migration-cat",
  );
});

test("listConfigurations with categoryId and filter applies name substring match", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes("/sessions")) return authResponse();
    return Response.json({
      relations: {
        link: [
          {
            rel: "down",
            attributes: [
              { name: "id", value: "c1" },
              { name: "name", value: "Email Configuration" },
              { name: "type", value: "ConfigurationElement" },
            ],
          },
          {
            rel: "down",
            attributes: [
              { name: "id", value: "c2" },
              { name: "name", value: "Auth Server Settings" },
              { name: "type", value: "ConfigurationElement" },
            ],
          },
        ],
      },
    });
  };

  const client = new VroClient(config());
  const result = await client.listConfigurations("email", "cat-id");

  assert.equal(result.total, 1);
  assert.equal(result.link[0].name, "Email Configuration");
});

test("listWorkflowsByCategory resolves paths from category details and relations", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();

    const href = String(url);
    if (
      href.endsWith(
        "/categories?categoryType=WorkflowCategory&maxResult=100&startIndex=0&queryCount=true",
      )
    ) {
      return Response.json({
        link: [
          {
            attributes: [
              { name: "id", value: "test-root" },
              { name: "name", value: "test" },
            ],
          },
          {
            attributes: [
              { name: "id", value: "minko" },
              { name: "name", value: "minko" },
            ],
          },
          {
            attributes: [
              { name: "id", value: "sql" },
              { name: "name", value: "sql" },
            ],
          },
          {
            attributes: [
              { name: "id", value: "other" },
              { name: "name", value: "sql" },
              { name: "path", value: "/other/sql" },
            ],
          },
        ],
      });
    }

    if (href.endsWith("/categories/minko")) {
      return Response.json({
        id: "minko",
        name: "minko",
        type: "WorkflowCategory",
        path: "test/minko",
        relations: {
          link: [
            {
              rel: "down",
              attributes: [
                { name: "id", value: "sql" },
                { name: "name", value: "sql" },
                { name: "type", value: "WorkflowCategory" },
              ],
            },
            {
              rel: "down",
              attributes: [
                { name: "id", value: "wf-simple" },
                { name: "name", value: "simple test" },
                { name: "type", value: "Workflow" },
              ],
            },
          ],
        },
      });
    }

    if (href.endsWith("/categories/sql")) {
      return Response.json({
        id: "sql",
        name: "sql",
        type: "WorkflowCategory",
        path: "test/minko/sql",
        relations: {
          link: [
            {
              rel: "down",
              attributes: [
                { name: "id", value: "wf-read" },
                { name: "name", value: "Read active record for 'entity'" },
                { name: "type", value: "Workflow" },
              ],
            },
          ],
        },
      });
    }

    return Response.json({ link: [] });
  };

  const client = new VroClient(config());
  const result = await client.listWorkflowsByCategory({
    categoryPath: "test/minko",
  });

  assert.equal(result.rootCategory.id, "minko");
  assert.equal(result.workflowCount, 2);
  assert.deepEqual(
    result.categories.map((group) => group.category.path),
    ["test/minko", "test/minko/sql"],
  );
  assert.deepEqual(
    result.categories.flatMap((group) =>
      group.workflows.map((workflow) => workflow.name),
    ),
    ["simple test", "Read active record for 'entity'"],
  );
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/categories?categoryType=WorkflowCategory&maxResult=100&startIndex=0&queryCount=true",
  );
  assert.equal(
    calls[2].url,
    "https://vcfa.example.test/vco/api/categories/minko",
  );
});

test("listWorkflowsByCategory includes empty categories when requested", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/sessions")) return authResponse();

    const href = String(url);
    if (
      href.endsWith(
        "/categories?categoryType=WorkflowCategory&maxResult=100&startIndex=0&queryCount=true",
      )
    ) {
      return Response.json({
        link: [
          {
            attributes: [
              { name: "id", value: "root" },
              { name: "name", value: "test" },
            ],
          },
        ],
      });
    }

    if (href.endsWith("/categories/root")) {
      return Response.json({
        id: "root",
        name: "test",
        type: "WorkflowCategory",
        relations: {
          link: [
            {
              rel: "down",
              attributes: [
                { name: "id", value: "child" },
                { name: "name", value: "minko" },
                { name: "type", value: "WorkflowCategory" },
              ],
            },
          ],
        },
      });
    }

    if (href.endsWith("/categories/child")) {
      return Response.json({
        id: "child",
        name: "minko",
        type: "WorkflowCategory",
        relations: { link: [] },
      });
    }

    return Response.json({ link: [] });
  };

  const client = new VroClient(config());
  const result = await client.listWorkflowsByCategory({
    categoryId: "root",
    includeEmptyCategories: true,
  });

  assert.equal(result.workflowCount, 0);
  assert.deepEqual(
    result.categories.map((group) => [group.category.id, group.workflows.length]),
    [
      ["child", 0],
      ["root", 0],
    ],
  );
});

test("listWorkflowsByCategory reports ambiguity", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/sessions")) return authResponse();
    if (String(url).includes("/categories")) {
      return Response.json({
        link: [
          {
            attributes: [
              { name: "id", value: "test-1" },
              { name: "name", value: "test" },
            ],
          },
          {
            attributes: [
              { name: "id", value: "test-2" },
              { name: "name", value: "test" },
            ],
          },
        ],
      });
    }
    return Response.json({ link: [] });
  };

  const client = new VroClient(config());
  await assert.rejects(
    () => client.listWorkflowsByCategory({ categoryName: "test" }),
    /Multiple WorkflowCategory entries match name 'test'/,
  );
});

test("listWorkflowsByCategory uses vRA8 read-only requests", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/categories")) {
      return Response.json({
        link: [
          {
            attributes: [
              { name: "id", value: "test-root" },
              { name: "name", value: "test" },
              { name: "path", value: "/test" },
            ],
          },
        ],
      });
    }
    return Response.json({ link: [] });
  };

  const client = new VroClient(config({ targetPlatform: "vra8" }));
  const result = await client.listWorkflowsByCategory({
    categoryPath: "/test",
  });

  assert.equal(result.workflowCount, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[1].init.method, "GET");
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

test("package export uses content endpoint with package export options", async () => {
  const packageDir = await mkdtemp(join(tmpdir(), "vcfa-packages-"));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("package-content", { status: 200 });
  };

  try {
    const client = new VroClient(config({ packageDir }));
    await client.exportPackage("com.example.project", "project.package", false, {
      exportConfigurationAttributeValues: true,
      exportGlobalTags: false,
      exportVersionHistory: true,
    });

    assert.equal(
      calls[1].url,
      "https://vcfa.example.test/vco/api/content/packages/com.example.project?exportConfigurationAttributeValues=true&exportGlobalTags=false&exportVersionHistory=true",
    );
    assert.equal(calls[1].init.method, "GET");
  } finally {
    await rm(packageDir, { recursive: true, force: true });
  }
});

test("project package reuse refuses to create without explicit confirmation", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("missing", { status: 404, statusText: "Not Found" });
  };

  const client = new VroClient(
    config({ projectPackageName: "com.example.project" }),
  );
  await assert.rejects(
    () => client.ensureProjectPackage(),
    /createIfMissing and confirm/,
  );

  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/packages/com.example.project",
  );
  assert.equal(calls.length, 2);
});

test("project package reuse creates exact package only when confirmed", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    if (calls.length === 2) {
      return new Response("missing", { status: 404, statusText: "Not Found" });
    }
    return new Response("", { status: 201 });
  };

  const client = new VroClient(
    config({ projectPackageName: "com.example.project" }),
  );
  const result = await client.ensureProjectPackage({
    createIfMissing: true,
    confirm: true,
    description: "Project package",
  });

  assert.deepEqual(result, { name: "com.example.project", created: true });
  assert.equal(calls[2].init.method, "PUT");
  assert.equal(
    calls[2].url,
    "https://vcfa.example.test/vco/api/packages/com.example.project",
  );
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    description: "Project package",
  });
});

test("package content helpers target the resolved package endpoints", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("", { status: 200 });
  };

  const client = new VroClient(config());
  await client.addWorkflowToPackage("com.example.project", "workflow-1");
  await client.addActionToPackage("com.example.project", "com.example", "echo");
  await client.addConfigurationToPackage("com.example.project", "config-1");
  await client.addResourceToPackage("com.example.project", "resource-1");
  await client.rebuildPackage("com.example.project");

  assert.deepEqual(
    calls.slice(1).map((call) => [call.init.method, call.url]),
    [
      [
        "POST",
        "https://vcfa.example.test/vco/api/packages/com.example.project/workflow/workflow-1",
      ],
      [
        "POST",
        "https://vcfa.example.test/vco/api/packages/com.example.project/action/com.example/echo",
      ],
      [
        "POST",
        "https://vcfa.example.test/vco/api/packages/com.example.project/configuration/config-1",
      ],
      [
        "POST",
        "https://vcfa.example.test/vco/api/packages/com.example.project/resource/resource-1",
      ],
      [
        "POST",
        "https://vcfa.example.test/vco/api/packages/com.example.project/rebuild",
      ],
    ],
  );
});

test("package import details uploads package without importing it", async () => {
  const packageDir = await mkdtemp(join(tmpdir(), "vcfa-packages-"));
  await writeFile(join(packageDir, "payload.package"), xmlArchive("package"));
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({
      packageName: "com.example.project",
      contentVerified: true,
      importElementDetails: [{ id: "workflow-1" }],
    });
  };

  try {
    const client = new VroClient(config({ packageDir }));
    const details = await client.getPackageImportDetails("payload.package");

    assert.equal(details.packageName, "com.example.project");
    assert.equal(
      calls[1].url,
      "https://vcfa.example.test/vco/api/packages/import-details",
    );
    assert.equal(calls[1].init.method, "POST");
    assert.equal(calls[1].init.body.get("file").name, "payload.package");
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

test("ignoreTls config does not mutate NODE_TLS_REJECT_UNAUTHORIZED", () => {
  const previous = process.env["NODE_TLS_REJECT_UNAUTHORIZED"];

  try {
    delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
    new VroClient(config({ ignoreTls: true }));
    assert.equal(process.env["NODE_TLS_REJECT_UNAUTHORIZED"], undefined);
  } finally {
    if (previous === undefined) {
      delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
    } else {
      process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = previous;
    }
  }
});

test("ignoreTls config scopes TLS relaxation to the client's own requests", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({ link: [], total: 0 });
  };

  const client = new VroClient(config({ ignoreTls: true }));
  await client.listWorkflows();

  assert.equal(
    calls[0].url,
    "https://vcfa.example.test/cloudapi/1.0.0/sessions",
  );
  assert.ok(
    calls[0].init.dispatcher,
    "session auth call should carry a TLS-relaxed dispatcher",
  );
  assert.ok(
    calls[1].init.dispatcher,
    "authenticated API call should carry a TLS-relaxed dispatcher",
  );
});

test("close releases the TLS-relaxed dispatcher and is idempotent", async () => {
  const relaxed = new VroClient(config({ ignoreTls: true }));
  await relaxed.close();
  await relaxed.close();

  const strict = new VroClient(config());
  await strict.close();
});

test("requests carry no dispatcher when ignoreTls is not set", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({ link: [], total: 0 });
  };

  const client = new VroClient(config());
  await client.listWorkflows();

  assert.equal(calls[0].init.dispatcher, undefined);
  assert.equal(calls[1].init.dispatcher, undefined);
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
      return new Response(JSON.stringify({ status: 404 }), {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "application/json" },
      });
    }
    if (calls.length === 3) {
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
    calls[1].url,
    "https://vcfa.example.test/vco/api/actions/action-1",
  );
  assert.equal(calls[1].init.method, "GET");
  assert.equal(
    calls[3].url,
    "https://vcfa.example.test/vco/api/actions/com.example.actions/getVmIp",
  );
  assert.equal(calls[3].init.method, "GET");
  assert.equal(action.script, "return vm.ipAddress;");
});

test("getAction rethrows direct lookup errors that are not not-found responses", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return new Response("boom", {
      status: 500,
      statusText: "Internal Server Error",
    });
  };

  const client = new VroClient(config());
  await assert.rejects(
    () => client.getAction("action-1"),
    /500 Internal Server Error/,
  );

  assert.equal(calls.length, 2);
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/actions/action-1",
  );
});

test("getAction accepts opaque action ids directly", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return authResponse();
    return Response.json({
      id: "opaque-action-id",
      name: "processSnmpResult",
      module: "com.vmware.library.snmp",
      script: "return result;",
    });
  };

  const client = new VroClient(config());
  const action = await client.getAction("opaque-action-id");

  assert.equal(calls.length, 2);
  assert.equal(
    calls[1].url,
    "https://vcfa.example.test/vco/api/actions/opaque-action-id",
  );
  assert.equal(action.module, "com.vmware.library.snmp");
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
    "https://vcfa.example.test/vco/api/resources?conditions=name~logo&maxResult=100&startIndex=0&queryCount=true",
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

// ─── sanitizeErrorBody unit tests ─────────────────────────────────────────────

test("sanitizeErrorBody includes safe JSON fields", () => {
  const body = JSON.stringify({ message: "Not found", statusCode: 404 });
  const result = sanitizeErrorBody(body);
  assert.ok(result.includes("Not found"), "should include message");
  assert.ok(result.includes("404"), "should include statusCode");
});

test("sanitizeErrorBody strips sensitive fields from JSON", () => {
  const body = JSON.stringify({
    message: "Auth failed",
    password: "s3cr3t",
    token: "tok123",
    secret: "mysecret",
  });
  const result = sanitizeErrorBody(body);
  assert.ok(result.includes("Auth failed"), "should include message");
  assert.ok(!result.includes("s3cr3t"), "should not include password value");
  assert.ok(!result.includes("tok123"), "should not include token value");
  assert.ok(!result.includes("mysecret"), "should not include secret value");
});

test("sanitizeErrorBody truncates non-JSON body", () => {
  const longHtml = "<html>" + "x".repeat(500) + "</html>";
  const result = sanitizeErrorBody(longHtml);
  assert.ok(result.includes("[non-JSON body:"), "should flag non-JSON");
  assert.ok(result.length < longHtml.length, "should be shorter than input");
});

test("sanitizeErrorBody handles empty body", () => {
  const result = sanitizeErrorBody("");
  assert.equal(result, "", "empty body should produce empty string");
});

test("sanitizeErrorBody surfaces nested errors array messages", () => {
  const body = JSON.stringify({
    errors: [{ message: "Workflow not found" }, { message: "Permission denied" }],
  });
  const result = sanitizeErrorBody(body);
  assert.ok(result.includes("Workflow not found"), "should include first error message");
  assert.ok(result.includes("Permission denied"), "should include second error message");
});

test("sanitizeErrorBody includes correlation ID header when present", () => {
  const body = JSON.stringify({ message: "Bad request" });
  const res = new Response(body, {
    status: 400,
    headers: { "x-request-id": "req-abc-123" },
  });
  const result = sanitizeErrorBody(body, res);
  assert.ok(result.includes("req-abc-123"), "should include correlation ID");
  assert.ok(result.includes("Bad request"), "should include message");
});

test("sanitizeErrorBody via auth failure path does not expose sensitive body content", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url) });
    return new Response(
      JSON.stringify({ message: "Unauthorized", internalToken: "leaked-token" }),
      { status: 401, statusText: "Unauthorized" },
    );
  };

  const client = new VroClient(config());
  await assert.rejects(
    () => client.listWorkflows(),
    (e) => {
      assert.ok(!e.message.includes("leaked-token"), "should not expose internalToken value");
      assert.ok(e.message.includes("Unauthorized"), "should include message field");
      return true;
    },
  );
});

// ─── Token refresh tests (VCFO-038) ──────────────────────────────────────────

test("401 after cached token triggers one re-auth and retry then succeeds", async () => {
  const calls = [];
  let authCount = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    // Auth calls → always succeed
    if (String(url).includes("/cloudapi/1.0.0/sessions")) {
      authCount++;
      return new Response("", {
        status: 200,
        headers: { "x-vmware-vcloud-access-token": `token-${authCount}` },
      });
    }
    // First API call → 401 (stale token)
    if (calls.filter((c) => !c.url.includes("/sessions")).length === 1) {
      return new Response("", { status: 401, statusText: "Unauthorized" });
    }
    // Retry → success
    return Response.json({ link: [], total: 0 });
  };

  const client = new VroClient(config());
  const result = await client.listWorkflows();

  assert.equal(result.total, 0);
  // 1st auth + 1st API call (401) + 2nd auth (refresh) + retry = 4
  assert.equal(calls.length, 4);
  assert.equal(authCount, 2, "should have authenticated twice");
  // The retry should use the refreshed token
  const retryCall = calls[3];
  assert.equal(retryCall.init.headers.Authorization, "Bearer token-2");
});

test("second consecutive 401 after re-auth is surfaced without infinite loop", async () => {
  let authCount = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/cloudapi/1.0.0/sessions")) {
      authCount++;
      return new Response("", {
        status: 200,
        headers: { "x-vmware-vcloud-access-token": `token-${authCount}` },
      });
    }
    // Always return 401
    return new Response(JSON.stringify({ message: "Token rejected" }), {
      status: 401,
      statusText: "Unauthorized",
    });
  };

  const client = new VroClient(config());
  await assert.rejects(() => client.listWorkflows(), /401 Unauthorized/);
  assert.equal(authCount, 2, "should authenticate exactly twice (initial + refresh)");
});

test("403 triggers the same token refresh as 401", async () => {
  const calls = [];
  let authCount = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url) });
    if (String(url).includes("/cloudapi/1.0.0/sessions")) {
      authCount++;
      return new Response("", {
        status: 200,
        headers: { "x-vmware-vcloud-access-token": `token-${authCount}` },
      });
    }
    if (calls.filter((c) => !c.url.includes("/sessions")).length === 1) {
      return new Response("", { status: 403, statusText: "Forbidden" });
    }
    return Response.json({ link: [], total: 0 });
  };

  const client = new VroClient(config());
  const result = await client.listWorkflows();
  assert.equal(result.total, 0);
  assert.equal(authCount, 2, "should re-authenticate on 403");
});

test("vra8 mode does NOT retry on 401 (Basic auth failure is terminal)", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push({ url: String(url) });
    return new Response(JSON.stringify({ message: "Bad credentials" }), {
      status: 401,
      statusText: "Unauthorized",
    });
  };

  const client = new VroClient(config({ targetPlatform: "vra8" }));
  await assert.rejects(() => client.listWorkflows(), /401 Unauthorized/);
  // Only one call — no re-auth attempt for vra8
  assert.equal(calls.length, 1, "vra8 should not retry on 401");
});

test("manual binary export path retries on 401 with refreshed token", async () => {
  let authCount = 0;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/cloudapi/1.0.0/sessions")) {
      authCount++;
      return new Response("", {
        status: 200,
        headers: { "x-vmware-vcloud-access-token": `token-${authCount}` },
      });
    }
    // First content call → 401
    if (calls.filter((c) => c.url.includes("/content/workflows/")).length === 1) {
      return new Response("", { status: 401, statusText: "Unauthorized" });
    }
    // Retry → return a minimal zip buffer
    return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
      status: 200,
      headers: { "Content-Type": "application/zip" },
    });
  };

  const client = new VroClient(config());
  // exportWorkflowBuffer is the manual-fetch binary path
  const buffer = await client.exportWorkflowBuffer("wf-1");
  assert.ok(Buffer.isBuffer(buffer), "should return a Buffer");
  assert.equal(authCount, 2, "should have re-authenticated for binary export");
});

test("token refresh does not re-authenticate when authenticate() itself fails", async () => {
  let authCount = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/cloudapi/1.0.0/sessions")) {
      authCount++;
      if (authCount === 1) {
        return new Response("", {
          status: 200,
          headers: { "x-vmware-vcloud-access-token": "token-1" },
        });
      }
      // Second auth attempt fails
      return new Response(JSON.stringify({ message: "Service unavailable" }), {
        status: 503,
        statusText: "Service Unavailable",
      });
    }
    return new Response("", { status: 401, statusText: "Unauthorized" });
  };

  const client = new VroClient(config());
  await assert.rejects(
    () => client.listWorkflows(),
    /VCF authentication failed: 503/,
  );
  assert.equal(authCount, 2, "should attempt re-auth once then surface the auth failure");
});
