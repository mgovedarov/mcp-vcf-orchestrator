import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { VroClient } from "../vro-client.js";

export function registerPluginTools(
  server: McpServer,
  client: VroClient,
): void {
  server.registerTool(
    "list-plugins",
    {
      title: "List vRO Plugins",
      description:
        "List installed plugins in VCF Automation Orchestrator. Optionally filter by name substring.",
      inputSchema: z.object({
        filter: z
          .string()
          .optional()
          .describe("Filter plugins by name (substring match)"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ filter }): Promise<CallToolResult> => {
      try {
        const result = await client.listPlugins(filter);
        const plugins = result.link ?? [];
        if (plugins.length === 0) {
          return {
            content: [{ type: "text", text: "No plugins found." }],
          };
        }
        const lines = plugins.map((p) => {
          const label = p.displayName ?? p.name;
          let line = `• ${label}`;
          if (p.name !== label) line += ` (${p.name})`;
          if (p.version) line += ` v${p.version}`;
          if (p.description) line += ` — ${p.description}`;
          return line;
        });
        return {
          content: [
            {
              type: "text",
              text: `Found ${plugins.length} plugin(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list plugins: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
