import assert from "node:assert/strict";
import test from "node:test";
import { registerCatalogTools } from "../dist/tools/catalog-tools.js";
import { registerCategoryTools } from "../dist/tools/category-tools.js";
import { registerPluginTools } from "../dist/tools/plugin-tools.js";
import { registerTemplateTools } from "../dist/tools/template-tools.js";

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

test("catalog tools format list and detail responses", async () => {
  const handlers = registeredTools(registerCatalogTools, {
    listCatalogItems: async (search) => ({
      totalElements: 1,
      content: [
        {
          id: "catalog-1",
          name: `Ubuntu ${search}`,
          type: { name: "Cloud Template" },
          description: "Linux VM",
        },
      ],
    }),
    getCatalogItem: async (id) => ({
      id,
      name: "Ubuntu",
      description: "Linux VM",
      type: { name: "Cloud Template" },
      sourceType: "blueprint",
      sourceName: "Ubuntu Template",
      projectIds: ["project-1", "project-2"],
    }),
  });

  const list = await handlers.get("list-catalog-items")({ search: "22.04" });
  assert.match(list.content[0].text, /Found 1 catalog item/);
  assert.match(list.content[0].text, /Ubuntu 22\.04 \(id: catalog-1\)/);
  assert.match(list.content[0].text, /\[Cloud Template\]/);

  const detail = await handlers.get("get-catalog-item")({ id: "catalog-1" });
  assert.match(detail.content[0].text, /Catalog Item: Ubuntu/);
  assert.match(detail.content[0].text, /Projects: project-1, project-2/);
});

test("category and plugin tools handle empty and formatted lists", async () => {
  const categoryHandlers = registeredTools(registerCategoryTools, {
    listCategories: async (type, filter) => ({
      link:
        filter === "empty"
          ? []
          : [
              {
                id: "category-1",
                name: "Provisioning",
                path: "/Library/Provisioning",
                description: type,
              },
            ],
    }),
  });
  const pluginHandlers = registeredTools(registerPluginTools, {
    listPlugins: async () => ({
      link: [
        {
          name: "com.vmware.library",
          displayName: "VMware Library",
          version: "1.0.0",
          description: "Built-in workflows",
        },
      ],
    }),
  });

  const empty = await categoryHandlers.get("list-categories")({
    type: "WorkflowCategory",
    filter: "empty",
  });
  assert.equal(empty.content[0].text, "No WorkflowCategory categories found.");

  const categories = await categoryHandlers.get("list-categories")({
    type: "WorkflowCategory",
  });
  assert.match(categories.content[0].text, /Provisioning \(id: category-1\)/);
  assert.match(categories.content[0].text, /path: \/Library\/Provisioning/);

  const plugins = await pluginHandlers.get("list-plugins")({});
  assert.match(
    plugins.content[0].text,
    /VMware Library \(com\.vmware\.library\) v1\.0\.0/,
  );
});

test("template tools create and delete with confirmation", async () => {
  let createParams;
  let deletedId;
  const handlers = registeredTools(registerTemplateTools, {
    listTemplates: async () => ({
      totalElements: 1,
      content: [
        {
          id: "template-1",
          name: "Small VM",
          status: "RELEASED",
          projectName: "Platform",
        },
      ],
    }),
    getTemplate: async (id) => ({
      id,
      name: "Small VM",
      status: "DRAFT",
      valid: true,
      content: "formatVersion: 1",
    }),
    createTemplate: async (params) => {
      createParams = params;
      return { id: "template-2", name: params.name, status: "DRAFT" };
    },
    deleteTemplate: async (id) => {
      deletedId = id;
    },
  });

  const list = await handlers.get("list-templates")({});
  assert.match(
    list.content[0].text,
    /Small VM \(id: template-1\) \[RELEASED\]/,
  );

  const detail = await handlers.get("get-template")({ id: "template-1" });
  assert.match(detail.content[0].text, /Valid: true/);
  assert.match(detail.content[0].text, /Content:\nformatVersion: 1/);

  const created = await handlers.get("create-template")({
    name: "New VM",
    projectId: "project-1",
    description: "Demo",
    content: "formatVersion: 1",
    requestScopeOrg: true,
  });
  assert.deepEqual(createParams, {
    name: "New VM",
    projectId: "project-1",
    description: "Demo",
    content: "formatVersion: 1",
    requestScopeOrg: true,
  });
  assert.match(created.content[0].text, /ID: template-2/);

  const refused = await handlers.get("delete-template")({
    id: "template-2",
    confirm: false,
  });
  assert.equal(deletedId, undefined);
  assert.match(refused.content[0].text, /setting confirm to true/);

  await handlers.get("delete-template")({ id: "template-2", confirm: true });
  assert.equal(deletedId, "template-2");
});
