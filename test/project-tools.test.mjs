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
  assert.match(result.content[0].text, /collecting 1 of ~50 item\(s\)/);
  // The shared advice applies now that the search reaches the server: a
  // narrower search retrieves projects beyond the request cap.
  assert.match(result.content[0].text, /Narrow the query with a filter/);
});

test("list-projects truncation warning describes the server-side match", async () => {
  const handlers = registeredTools(registerProjectTools, {
    listProjects: async () => ({
      totalElements: 250,
      numberOfElements: 200,
      truncated: true,
      content: Array.from({ length: 200 }, (_, index) => ({
        id: `p-${index}`,
        name: `dev-${index}`,
      })),
    }),
  });

  const result = await handlers.get("list-projects")({ search: "dev" });
  assert.match(result.content[0].text, /Found 250 project\(s\)/);
  assert.match(result.content[0].text, /collecting 200 of ~250 item\(s\)/);
});

test("list-projects keeps the truncation warning when a search matches nothing", async () => {
  const handlers = registeredTools(registerProjectTools, {
    listProjects: async () => ({
      totalElements: 0,
      numberOfElements: 0,
      truncated: true,
      content: [],
    }),
  });

  const result = await handlers.get("list-projects")({ search: "legacy" });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /^No projects found matching "legacy"\./);
  assert.match(result.content[0].text, /Results truncated/);
  assert.match(result.content[0].text, /collecting 0 item\(s\)/);
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

test("get-project renders the project-service fields verified on vRA 8.18", async () => {
  // Shape observed on the vRA 8.18 lab under VCFO-065 (names and IDs only).
  const handlers = registeredTools(registerProjectTools, {
    getProject: async (id) => ({
      id,
      name: "Development",
      description: "",
      orgId: "org-1",
      administrators: [],
      members: [{ email: "dev@example.test", type: "user" }],
      viewers: [{ email: "ops@example.test", type: "group" }, {}],
      supervisors: [],
      constraints: { network: [{ mandatory: true }], storage: [] },
      properties: {
        __namingTemplate: "${project.name}-${###}",
        __projectPlacementPolicy: "DEFAULT",
        costCenter: "CC-42",
        vaultToken: "must-not-print",
        tags: ["a", "b"],
      },
      operationTimeout: 7200,
      sharedResources: false,
    }),
  });

  const result = await handlers.get("get-project")({ id: "p-1" });
  assert.equal(result.isError, undefined);
  assert.equal(
    result.content[0].text,
    [
      "Project: Development",
      "ID: p-1",
      "Organization ID: org-1",
      "Shared resources: no",
      "Operation timeout: 7200s",
      "Machine naming template: ${project.name}-${###}",
      "Placement policy: DEFAULT",
      "Custom properties:",
      "  costCenter: CC-42",
      "  vaultToken: [redacted]",
      '  tags: ["a","b"]',
      "Administrators: none",
      "Members: 1 — dev@example.test (user)",
      "Viewers: 2 — ops@example.test (group), (unnamed)",
      "Supervisors: none",
      "Constraints: network 1",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(result.content[0].text, /must-not-print/);
});

test("get-project omits sections the response does not carry", async () => {
  const handlers = registeredTools(registerProjectTools, {
    getProject: async (id) => ({
      id,
      name: "Sparse",
      sharedResources: true,
      constraints: {},
      properties: {},
    }),
  });

  const result = await handlers.get("get-project")({ id: "p-3" });
  assert.equal(
    result.content[0].text,
    "Project: Sparse\nID: p-3\nShared resources: yes\nConstraints: none\n",
  );
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
