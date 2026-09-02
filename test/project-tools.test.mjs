import assert from "node:assert/strict";
import test from "node:test";
import { registerProjectTools } from "../dist/tools/project-tools.js";

function registeredTools(register, client) {
  const handlers = new Map();
  const server = {
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
  };
  register(server, client);
  return handlers;
}

test("list-projects formats name, id, and description lines", async () => {
  let received;
  const handlers = registeredTools(registerProjectTools, {
    listProjects: async (search) => {
      received = search;
      return {
        totalElements: 2,
        content: [
          { id: "p-1", name: "Dev", description: "Dev sandbox" },
          { id: "p-2", name: "Prod" },
        ],
      };
    },
  });

  const result = await handlers.get("list-projects")({ search: "Dev" });
  assert.equal(received, "Dev");
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /Found 2 project\(s\)/);
  assert.match(result.content[0].text, /• Dev \(id: p-1\) — Dev sandbox/);
  assert.match(result.content[0].text, /• Prod \(id: p-2\)$/m);
  assert.doesNotMatch(result.content[0].text, /Results truncated/);
});

test("list-projects reports empty results with and without a search", async () => {
  const handlers = registeredTools(registerProjectTools, {
    listProjects: async () => ({ totalElements: 0, content: [] }),
  });

  const all = await handlers.get("list-projects")({});
  assert.equal(all.content[0].text, "No projects found.");

  const filtered = await handlers.get("list-projects")({ search: "x" });
  assert.equal(filtered.content[0].text, 'No projects found matching "x".');

  // The client trims and ignores whitespace-only searches, so the message
  // must not claim a filter was applied.
  const blank = await handlers.get("list-projects")({ search: "   " });
  assert.equal(blank.content[0].text, "No projects found.");

  const padded = await handlers.get("list-projects")({ search: "  qa " });
  assert.equal(padded.content[0].text, 'No projects found matching "qa".');
});

test("list-projects surfaces a pagination truncation warning", async () => {
  const handlers = registeredTools(registerProjectTools, {
    listProjects: async () => ({
      totalElements: 50,
      truncated: true,
      content: [{ id: "p-1", name: "Dev" }],
    }),
  });

  const result = await handlers.get("list-projects")({});
  assert.match(result.content[0].text, /Found 50 project\(s\)/);
  assert.match(result.content[0].text, /Results truncated/);
  assert.match(result.content[0].text, /scanning 1 of ~50 project\(s\)/);
  // The shared "narrow the query with a filter" advice does not apply: the
  // search is client-side and cannot recover unscanned projects.
  assert.doesNotMatch(result.content[0].text, /Narrow the query/);
  assert.match(result.content[0].text, /cannot retrieve them/);
});

test("list-projects truncation warning reports the scanned inventory, not the match count", async () => {
  const handlers = registeredTools(registerProjectTools, {
    listProjects: async () => ({
      totalElements: 3,
      numberOfElements: 3,
      scannedElements: 200,
      inventoryTotalElements: 5000,
      truncated: true,
      content: [
        { id: "p-1", name: "dev-a" },
        { id: "p-2", name: "dev-b" },
        { id: "p-3", name: "dev-c" },
      ],
    }),
  });

  const result = await handlers.get("list-projects")({ search: "dev" });
  assert.match(result.content[0].text, /Found 3 project\(s\)/);
  assert.match(result.content[0].text, /scanning 200 of ~5000 project\(s\)/);
});

test("list-projects keeps the truncation warning when a search matches nothing", async () => {
  const handlers = registeredTools(registerProjectTools, {
    listProjects: async () => ({
      totalElements: 0,
      numberOfElements: 0,
      scannedElements: 200,
      inventoryTotalElements: 5000,
      truncated: true,
      content: [],
    }),
  });

  const result = await handlers.get("list-projects")({ search: "legacy" });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /^No projects found matching "legacy"\./);
  assert.match(result.content[0].text, /Results truncated/);
  assert.match(result.content[0].text, /scanning 200 of ~5000 project\(s\)/);
});

test("get-project renders id, name, and optional description", async () => {
  const handlers = registeredTools(registerProjectTools, {
    getProject: async (id) =>
      id === "p-1"
        ? { id, name: "Dev", description: "Dev sandbox" }
        : { id, name: "Prod" },
  });

  const withDescription = await handlers.get("get-project")({ id: "p-1" });
  assert.equal(
    withDescription.content[0].text,
    "Project: Dev\nID: p-1\nDescription: Dev sandbox\n",
  );

  const withoutDescription = await handlers.get("get-project")({ id: "p-2" });
  assert.equal(withoutDescription.content[0].text, "Project: Prod\nID: p-2\n");
});

test("project tools return isError text when the client fails", async () => {
  const handlers = registeredTools(registerProjectTools, {
    listProjects: async () => {
      throw new Error("boom");
    },
    getProject: async () => {
      throw new Error("missing");
    },
  });

  const list = await handlers.get("list-projects")({});
  assert.equal(list.isError, true);
  assert.match(list.content[0].text, /Failed to list projects: boom/);

  const detail = await handlers.get("get-project")({ id: "p-1" });
  assert.equal(detail.isError, true);
  assert.match(detail.content[0].text, /Failed to get project: missing/);
});
