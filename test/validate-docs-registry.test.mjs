import assert from "node:assert/strict";
import test from "node:test";
import {
  collectRegistry,
  collectRegistryFromSources,
  maskSource,
} from "../scripts/validate-docs.mjs";

function registryFor(text) {
  return collectRegistryFromSources([{ path: "fixture.ts", text }]);
}

test("collects a tool name and the top-level z.object schema keys", () => {
  const registry = registryFor(`
    server.registerTool(
      "list-things",
      {
        title: "List Things",
        description: "Lists things: with (tricky) {chars}.",
        inputSchema: z.object({
          filter: z.string().optional().describe("a: b, c(d) {e}"),
          "quoted-key": z.number(),
          nested: z.object({ inner: z.string() }),
        }),
        annotations: { readOnlyHint: true },
      },
      async ({ filter }) => ({}),
    );
  `);
  assert.deepEqual([...registry.tools.keys()], ["list-things"]);
  assert.deepEqual(
    [...registry.tools.get("list-things")].sort(),
    ["filter", "nested", "quoted-key"],
  );
});

test("collects prompt names and raw argsSchema object keys", () => {
  const registry = registryFor(`
    server.registerPrompt(
      "vcfa-do-thing",
      {
        title: "Do Thing",
        argsSchema: {
          goal: z.string(),
          hint: z.string().optional(),
        },
      },
      handler,
    );
  `);
  assert.deepEqual([...registry.prompts.keys()], ["vcfa-do-thing"]);
  assert.deepEqual([...registry.prompts.get("vcfa-do-thing")].sort(), [
    "goal",
    "hint",
  ]);
});

test("a tool without an inputSchema is collected with no argument names", () => {
  const registry = registryFor(`
    server.registerTool("no-args", { title: "No Args" }, handler);
  `);
  assert.deepEqual([...registry.tools.get("no-args")], []);
});

test("collects resource URI strings, templates, and ResourceTemplate URIs", () => {
  const registry = registryFor(`
    server.registerResource("docs", "vcfa://docs/readme", {}, cb);
    server.registerResource("tpl", \`vcfa://patterns/conventions\`, {}, cb);
    server.registerResource(
      "snapshots",
      new ResourceTemplate("vcfa://context/snapshots/{fileName}", {
        list: async () => listSnapshots(server, client),
      }),
      {},
      cb,
    );
  `);
  assert.deepEqual(
    [...registry.resources].sort(),
    [
      "vcfa://context/snapshots/{fileName}",
      "vcfa://docs/readme",
      "vcfa://patterns/conventions",
    ],
  );
});

test("ignores registrations inside comments and string literals", () => {
  const registry = registryFor(`
    // server.registerTool("commented-out", { inputSchema: z.object({}) }, cb);
    /* server.registerPrompt("also-commented", { argsSchema: {} }, cb); */
    const doc = 'call server.registerResource("x", "vcfa://fake", {}) later';
    const tpl = \`and server.registerTool("templated", {}, cb)\`;
    server.registerTool("real-tool", { inputSchema: z.object({ a: z.string() }) }, cb);
  `);
  assert.deepEqual([...registry.tools.keys()], ["real-tool"]);
  assert.equal(registry.prompts.size, 0);
  assert.equal(registry.resources.size, 0);
});

test("regex literals containing quotes and braces do not derail scanning", () => {
  const registry = registryFor(`
    const stripQuotes = /["'{}(]/g;
    const parts = value.split(/[,;]/).map((p) => /\\d+/.test(p));
    server.registerTool(
      "after-regex",
      { inputSchema: z.object({ id: z.string() }) },
      cb,
    );
  `);
  assert.deepEqual([...registry.tools.keys()], ["after-regex"]);
  assert.deepEqual([...registry.tools.get("after-regex")], ["id"]);
});

test("template substitutions in config values do not affect key collection", () => {
  const registry = registryFor(`
    server.registerTool(
      "templated-description",
      {
        description: \`prefix \${JSON.stringify({ not: "a key" })} suffix\`,
        inputSchema: z.object({ real: z.string() }),
      },
      cb,
    );
  `);
  assert.deepEqual([...registry.tools.get("templated-description")], ["real"]);
});

test("dynamic names, non-literal configs, and lookalike calls are skipped", () => {
  const registry = registryFor(`
    server.registerTool(dynamicName, { inputSchema: z.object({}) }, cb);
    server.registerTool(\`interp-\${kind}\`, { inputSchema: z.object({}) }, cb);
    server.registerTool("shared-config", sharedConfig, cb);
    registerResourceTools(server, client);
    const label = "vcfa://not-registered";
  `);
  assert.equal(registry.tools.size, 0);
  assert.equal(registry.resources.size, 0);
});

test("whitespace between the dot, name, and parenthesis is tolerated", () => {
  const registry = registryFor(`
    server
      .registerTool (
        "spread-out",
        { inputSchema: z.object({ a: z.string() }) },
        cb,
      );
  `);
  assert.deepEqual([...registry.tools.keys()], ["spread-out"]);
});

test("maskSource blanks comments, strings, and regexes but keeps structure", () => {
  const masked = maskSource(
    'const re = /"/; // comment (with parens)\nconst s = "a(b{c";\ncall(x);',
  );
  assert.equal(masked.length, 'const re = /"/; // comment (with parens)\nconst s = "a(b{c";\ncall(x);'.length);
  assert.ok(!masked.includes("comment"));
  assert.ok(!masked.includes("a(b{c"));
  assert.ok(masked.includes("call(x);"));
  const brackets = [...masked].filter((c) => "(){}[]".includes(c)).join("");
  assert.equal(brackets, "()");
});

test("live registry matches the documented counts shape", () => {
  const registry = collectRegistry();
  assert.ok(registry.tools.size > 0, "expected registered tools");
  assert.ok(registry.prompts.size > 0, "expected registered prompts");
  assert.ok(registry.resources.size > 0, "expected registered resources");
  for (const keys of registry.tools.values()) {
    assert.ok(keys instanceof Set);
  }
});
