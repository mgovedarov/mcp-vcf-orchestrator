import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { VroClient } from "../vro-client.js";

export function registerTemplateTools(
  server: McpServer,
  client: VroClient,
): void {
  server.registerTool(
    "list-templates",
    {
      title: "List Templates",
      description:
        "List blueprint templates in VCF Automation Cloud Assembly. Optionally filter by name/keyword search or by project ID.",
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe("Search templates by name or keyword"),
        projectId: z
          .string()
          .optional()
          .describe("Filter templates by project ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ search, projectId }): Promise<CallToolResult> => {
      try {
        const result = await client.listTemplates(search, projectId);
        const items = result.content ?? [];
        if (items.length === 0) {
          return {
            content: [{ type: "text", text: "No templates found." }],
          };
        }
        const lines = items.map((t) => {
          let line = `• ${t.name} (id: ${t.id})`;
          if (t.status) line += ` [${t.status}]`;
          if (t.projectName) line += ` — project: ${t.projectName}`;
          else if (t.projectId) line += ` — projectId: ${t.projectId}`;
          if (t.description) line += ` — ${t.description}`;
          return line;
        });
        const total = result.totalElements ?? items.length;
        return {
          content: [
            {
              type: "text",
              text: `Found ${total} template(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list templates: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get-template",
    {
      title: "Get Template",
      description:
        "Get detailed information about a specific blueprint template by its ID.",
      inputSchema: z.object({
        id: z.string().describe("The template (blueprint) ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const t = await client.getTemplate(id);
        let text = `Template: ${t.name}\nID: ${t.id}\n`;
        if (t.status) text += `Status: ${t.status}\n`;
        if (t.description) text += `Description: ${t.description}\n`;
        if (t.projectName) text += `Project: ${t.projectName}\n`;
        else if (t.projectId) text += `Project ID: ${t.projectId}\n`;
        if (t.valid !== undefined) text += `Valid: ${t.valid}\n`;
        if (t.createdBy) text += `Created By: ${t.createdBy}\n`;
        if (t.createdAt) text += `Created At: ${t.createdAt}\n`;
        if (t.updatedBy) text += `Last Updated By: ${t.updatedBy}\n`;
        if (t.updatedAt) text += `Last Updated At: ${t.updatedAt}\n`;
        if (t.content) text += `\nContent:\n${t.content}\n`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get template: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "create-template",
    {
      title: "Create Template",
      description:
        "Create a new blueprint template in VCF Automation Cloud Assembly. Use list-templates to verify afterwards.",
      inputSchema: z.object({
        name: z.string().describe("Name for the new template"),
        projectId: z
          .string()
          .describe("The project ID in which to create the template"),
        description: z
          .string()
          .optional()
          .describe("Optional description for the template"),
        content: z
          .string()
          .optional()
          .describe(
            "YAML blueprint content for the template. If omitted, an empty template is created.",
          ),
        requestScopeOrg: z
          .boolean()
          .optional()
          .describe(
            "If true, the template is available org-wide rather than project-scoped",
          ),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      name,
      projectId,
      description,
      content,
      requestScopeOrg,
    }): Promise<CallToolResult> => {
      try {
        const template = await client.createTemplate({
          name,
          projectId,
          description,
          content,
          requestScopeOrg,
        });
        let text = `Template created successfully.\n`;
        if (template.id) text += `ID: ${template.id}\n`;
        if (template.name) text += `Name: ${template.name}\n`;
        if (template.status) text += `Status: ${template.status}\n`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to create template: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "delete-template",
    {
      title: "Delete Template",
      description:
        "Delete a blueprint template by its ID. Set confirm to true to proceed.",
      inputSchema: z.object({
        id: z.string().describe("The template (blueprint) ID to delete"),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm deletion. If false, the deletion will not proceed.",
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id, confirm }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm deletion of template ${id} by setting confirm to true. This action is irreversible.`,
            },
          ],
        };
      }
      try {
        await client.deleteTemplate(id);
        return {
          content: [
            { type: "text", text: `Template ${id} deleted successfully.` },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to delete template: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
