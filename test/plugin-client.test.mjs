import assert from "node:assert/strict";
import test from "node:test";
import { PluginClient } from "../dist/client/plugin-client.js";

// Stub the vRO HTTP client with a single page and record the requested paths.
// getAllVroPages stops once the reported total is reached or a page comes back
// shorter than the page size, so one page suffices.
function httpStub(page) {
  const calls = [];
  return {
    calls,
    get: async (path) => {
      calls.push(path);
      return page;
    },
  };
}

test("limited plugin filtering reaches later flat matches and trusts attribute items", async () => {
  const items = [
    { moduleName: "other" },
    { moduleName: "other-again" },
    { attributes: [{ name: "name", value: "server-match" }] },
    { id: "match-flat", enabled: false },
    { moduleName: "match-later" },
    { moduleName: "match-last" },
  ];
  const starts = [];
  const http = { get: async (path) => {
    const params = new URL(`https://example.test${path}`).searchParams;
    const start = Number(params.get("startIndex"));
    starts.push(start);
    assert.equal(params.get("maxResult"), "100");
    return { plugins: items.slice(start, start + 1), total: items.length };
  } };
  const result = await new PluginClient(http).listPlugins(" MATCH ", { limit: 1 });
  assert.deepEqual(result.link.map((item) => item.name), ["server-match"]);
  assert.equal(result.total, undefined);
  assert.equal(result.limited, true);
  assert.deepEqual(starts, [0, 1, 2, 3]);
});

test("limited flat plugins report exact matches when a response completes inventory", async () => {
  const http = httpStub({ total: 4, plugins: [
    { moduleName: "other" }, { id: "match-a", enabled: false },
    { moduleName: "match-b" }, { moduleName: "other-last" },
  ] });
  const result = await new PluginClient(http).listPlugins("match", { limit: 1 });
  assert.equal(result.total, 2);
  assert.equal(result.link[0].name, "match-a");
  assert.equal(result.link[0].enabled, false);
  assert.equal(result.limited, true);
  assert.equal(http.calls.length, 1);
});

test("listPlugins maps the vRO link/attributes envelope (VCF Automation 9.x)", async () => {
  const http = httpStub({
    total: 2,
    link: [
      {
        attributes: [
          { name: "name", value: "com.vmware.library" },
          { name: "display-name", value: "VMware Library" },
          { name: "version", value: "1.0.0" },
          { name: "description", value: "Built-in workflows" },
          { name: "type", value: "plugin" },
        ],
      },
      {
        attributes: [
          { name: "@name", value: "com.example.other" },
          { name: "displayName", value: "Other" },
        ],
      },
    ],
  });

  const result = await new PluginClient(http).listPlugins();

  assert.equal(result.total, 2);
  assert.deepEqual(result.link, [
    {
      name: "com.vmware.library",
      displayName: "VMware Library",
      version: "1.0.0",
      description: "Built-in workflows",
      type: "plugin",
    },
    {
      name: "com.example.other",
      displayName: "Other",
      version: undefined,
      description: undefined,
      type: undefined,
    },
  ]);
  // Attribute listings do not report plugin state.
  assert.ok(!("enabled" in result.link[0]));
  assert.deepEqual(http.calls, [
    "/plugins?maxResult=100&startIndex=0&queryCount=true",
  ]);
});

test("listPlugins maps the flat { plugins, total } envelope (vRO embedded in vRA 8)", async () => {
  const http = httpStub({
    plugins: [
      {
        buildNumber: "1001",
        description: "Core library",
        enabled: true,
        fileName: "o11nplugin-library.dar",
        id: "Library",
        logLevel: "DEFAULT",
        moduleName: "Library",
        version: "8.18.1",
      },
      {
        buildNumber: "1002",
        description: "",
        enabled: false,
        fileName: "o11nplugin-ssh.dar",
        id: "SSH",
        logLevel: "DEFAULT",
        moduleName: "SSH",
        version: "8.18.1",
      },
    ],
    total: 2,
  });

  const result = await new PluginClient(http).listPlugins();

  assert.equal(result.total, 2);
  assert.deepEqual(result.link, [
    {
      name: "Library",
      displayName: undefined,
      version: "8.18.1",
      description: "Core library",
      type: undefined,
      enabled: true,
    },
    {
      name: "SSH",
      displayName: undefined,
      version: "8.18.1",
      description: undefined,
      type: undefined,
      enabled: false,
    },
  ]);
  // Descriptor fields the tool does not render are not carried over.
  for (const plugin of result.link) {
    assert.ok(!("buildNumber" in plugin));
    assert.ok(!("fileName" in plugin));
    assert.ok(!("logLevel" in plugin));
    assert.ok(!("id" in plugin));
  }
  assert.ok(!("truncated" in result));
  assert.deepEqual(http.calls, [
    "/plugins?maxResult=100&startIndex=0&queryCount=true",
  ]);
});

test("listPlugins filters flat descriptors client-side because the vRA 8 endpoint ignores conditions", async () => {
  // The stub ignores the query string, like the live endpoint does.
  const page = {
    plugins: [
      { id: "a", moduleName: "Library", version: "8.18.1", enabled: true },
      { id: "b", moduleName: "SSH", version: "8.18.1", enabled: true },
      { id: "c", moduleName: "PowerShell", version: "8.18.1", enabled: true },
    ],
    total: 3,
  };

  const matched = await new PluginClient(httpStub(page)).listPlugins("ssh");
  assert.deepEqual(
    matched.link.map((plugin) => plugin.name),
    ["SSH"],
  );
  // The total now describes the matches, not the unfiltered inventory.
  assert.equal(matched.total, 1);

  const substring = await new PluginClient(httpStub(page)).listPlugins("SH");
  assert.deepEqual(
    substring.link.map((plugin) => plugin.name),
    ["SSH", "PowerShell"],
  );

  const http = httpStub(page);
  const none = await new PluginClient(http).listPlugins("nomatch");
  assert.deepEqual(none, { total: 0, link: [] });
  // The server-side condition is still sent for servers that honour it.
  assert.deepEqual(http.calls, [
    "/plugins?conditions=name~nomatch&maxResult=100&startIndex=0&queryCount=true",
  ]);
});

test("listPlugins leaves attribute listings to the server-side filter", async () => {
  const http = httpStub({
    total: 1,
    link: [
      {
        attributes: [
          { name: "name", value: "com.vmware.library" },
          { name: "display-name", value: "VMware Library" },
        ],
      },
    ],
  });

  // A server that returned this entry for the filter is trusted; the client
  // does not second-guess the match.
  const result = await new PluginClient(http).listPlugins("zzz");

  assert.equal(result.link.length, 1);
  assert.equal(result.total, 1);
  assert.deepEqual(http.calls, [
    "/plugins?conditions=name~zzz&maxResult=100&startIndex=0&queryCount=true",
  ]);
});

test("listPlugins falls back to the descriptor id when a flat entry omits moduleName", async () => {
  const http = httpStub({
    plugins: [{ id: "legacy-plugin", version: "1.0" }],
    total: 1,
  });

  const result = await new PluginClient(http).listPlugins();

  assert.deepEqual(result.link, [
    {
      name: "legacy-plugin",
      displayName: undefined,
      version: "1.0",
      description: undefined,
      type: undefined,
      enabled: undefined,
    },
  ]);
});

test("listPlugins returns an empty list when the envelope carries neither link nor plugins", async () => {
  const http = httpStub({ total: 0 });

  const result = await new PluginClient(http).listPlugins();

  assert.deepEqual(result, { total: 0, link: [] });
});
