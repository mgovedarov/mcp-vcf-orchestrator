import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { VroClient } from "../vro-client.js";

export function registerCatalogTools(
  server: McpServer,
  client: VroClient,
): void {
  server.registerTool(
    "list-catalog-items",
    {
      title: "List Catalog Items",
      description:
        "List available catalog items from the VCF Automation Service Broker. Optionally search by name or keyword.",
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe("Search catalog items by name or keyword"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ search }): Promise<CallToolResult> => {
      try {
        const result = await client.listCatalogItems(search);
        const items = result.content ?? [];
        if (items.length === 0) {
          return {
            content: [{ type: "text", text: "No catalog items found." }],
          };
        }
        const lines = items.map((item) => {
          let line = `• ${item.name} (id: ${item.id})`;
          if (item.type?.name) line += ` [${item.type.name}]`;
          if (item.description) line += ` — ${item.description}`;
          return line;
        });
        const total = result.totalElements ?? items.length;
        return {
          content: [
            {
              type: "text",
              text: `Found ${total} catalog item(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list catalog items: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get-catalog-item",
    {
      title: "Get Catalog Item",
      description:
        "Get detailed information about a specific catalog item by its ID.",
      inputSchema: z.object({
        id: z.string().describe("The catalog item ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const item = await client.getCatalogItem(id);
        let text = `Catalog Item: ${item.name}\nID: ${item.id}\n`;
        if (item.description) text += `Description: ${item.description}\n`;
        if (item.type?.name) text += `Type: ${item.type.name}\n`;
        if (item.sourceType) text += `Source Type: ${item.sourceType}\n`;
        if (item.sourceName) text += `Source: ${item.sourceName}\n`;
        if (item.projectIds && item.projectIds.length > 0) {
          text += `Projects: ${item.projectIds.join(", ")}\n`;
        }
        if (item.createdBy) text += `Created By: ${item.createdBy}\n`;
        if (item.createdAt) text += `Created At: ${item.createdAt}\n`;
        if (item.lastUpdatedBy)
          text += `Last Updated By: ${item.lastUpdatedBy}\n`;
        if (item.lastUpdatedAt)
          text += `Last Updated At: ${item.lastUpdatedAt}\n`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get catalog item: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
