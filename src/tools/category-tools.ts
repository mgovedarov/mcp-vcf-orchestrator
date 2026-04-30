import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { VroClient } from "../vro-client.js";

export function registerCategoryTools(
  server: McpServer,
  client: VroClient,
): void {
  server.registerTool(
    "list-categories",
    {
      title: "List Categories",
      description:
        "List categories in VCF Automation Orchestrator. Categories are needed to create workflows, actions, configuration elements, and resource elements. Use the type parameter to filter by category type.",
      inputSchema: z.object({
        type: z
          .enum([
            "WorkflowCategory",
            "ActionCategory",
            "ConfigurationElementCategory",
            "ResourceElementCategory",
          ])
          .describe("The category type to list"),
        filter: z
          .string()
          .optional()
          .describe("Filter categories by name (substring match)"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ type, filter }): Promise<CallToolResult> => {
      try {
        const result = await client.listCategories(type, filter);
        const categories = result.link ?? [];
        if (categories.length === 0) {
          return {
            content: [{ type: "text", text: `No ${type} categories found.` }],
          };
        }
        const lines = categories.map(
          (c) =>
            `• ${c.name} (id: ${c.id})${c.path ? ` — path: ${c.path}` : ""}${c.description ? ` — ${c.description}` : ""}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Found ${categories.length} ${type} category(ies):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list categories: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
