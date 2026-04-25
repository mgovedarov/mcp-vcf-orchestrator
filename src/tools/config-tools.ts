import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { VroClient } from "../vro-client.js";

export function registerConfigTools(
  server: McpServer,
  client: VroClient
): void {
  server.registerTool(
    "list-configurations",
    {
      title: "List Configuration Elements",
      description:
        "List configuration elements from VCF Automation Orchestrator. Optionally filter by name.",
      inputSchema: z.object({
        filter: z
          .string()
          .optional()
          .describe("Filter configuration elements by name (substring match)"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ filter }): Promise<CallToolResult> => {
      try {
        const result = await client.listConfigurations(filter);
        const configs = result.link ?? [];
        if (configs.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No configuration elements found.",
              },
            ],
          };
        }
        const lines = configs.map(
          (c) =>
            `• ${c.name} (id: ${c.id})${c.description ? ` — ${c.description}` : ""}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Found ${configs.length} configuration element(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list configurations: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "get-configuration",
    {
      title: "Get Configuration Element",
      description:
        "Get detailed information about a specific configuration element including its attributes.",
      inputSchema: z.object({
        id: z.string().describe("The configuration element ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const config = await client.getConfiguration(id);

        let text = `Configuration: ${config.name}\nID: ${config.id}\n`;
        if (config.description)
          text += `Description: ${config.description}\n`;
        if (config.version) text += `Version: ${config.version}\n`;

        const attrs = config.attributes ?? [];
        if (attrs.length > 0) {
          text += `\nAttributes:\n`;
          for (const a of attrs) {
            const val = a.value
              ? JSON.stringify(a.value)
              : "(no value)";
            text += `  • ${a.name} (${a.type}): ${val}${a.description ? ` — ${a.description}` : ""}\n`;
          }
        } else {
          text += `\nNo attributes.\n`;
        }
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get configuration: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "create-configuration",
    {
      title: "Create Configuration Element",
      description:
        "Create a new configuration element in VCF Automation Orchestrator. Use list-categories with type ConfigurationElementCategory to find a category ID first.",
      inputSchema: z.object({
        categoryId: z
          .string()
          .describe(
            "The category ID to create the configuration element in"
          ),
        name: z
          .string()
          .describe("Name for the new configuration element"),
        description: z
          .string()
          .optional()
          .describe("Optional description"),
        attributes: z
          .array(
            z.object({
              name: z.string().describe("Attribute name"),
              type: z
                .string()
                .describe("Attribute type (e.g. string, number, boolean)"),
              value: z
                .string()
                .optional()
                .describe("Attribute value as string"),
            })
          )
          .optional()
          .describe("Initial attributes for the configuration element"),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      categoryId,
      name,
      description,
      attributes,
    }): Promise<CallToolResult> => {
      try {
        const config = await client.createConfiguration(
          categoryId,
          name,
          description,
          attributes
        );
        return {
          content: [
            {
              type: "text",
              text: `Configuration element created successfully.\nName: ${config.name}\nID: ${config.id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to create configuration: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "delete-configuration",
    {
      title: "Delete Configuration Element",
      description:
        "Delete a configuration element from VCF Automation Orchestrator. This action is irreversible.",
      inputSchema: z.object({
        id: z.string().describe("The configuration element ID to delete"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        await client.deleteConfiguration(id);
        return {
          content: [
            {
              type: "text",
              text: `Configuration element ${id} deleted successfully.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to delete configuration: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
