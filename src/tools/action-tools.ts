import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { VroClient } from "../vro-client.js";

export function registerActionTools(
  server: McpServer,
  client: VroClient
): void {
  server.registerTool(
    "list-actions",
    {
      title: "List Actions",
      description:
        "List actions (scriptable tasks) from VCF Automation Orchestrator. Optionally filter by name.",
      inputSchema: z.object({
        filter: z
          .string()
          .optional()
          .describe("Filter actions by name (substring match)"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ filter }): Promise<CallToolResult> => {
      try {
        const result = await client.listActions(filter);
        const actions = result.link ?? [];
        if (actions.length === 0) {
          return {
            content: [{ type: "text", text: "No actions found." }],
          };
        }
        const lines = actions.map(
          (a) =>
            `• ${a.module}/${a.name} (id: ${a.id})${a.description ? ` — ${a.description}` : ""}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Found ${actions.length} action(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list actions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "get-action",
    {
      title: "Get Action Details",
      description:
        "Get detailed information about a specific action including its script content and parameters.",
      inputSchema: z.object({
        id: z.string().describe("The action ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const action = await client.getAction(id);
        const inputParams = action["input-parameters"] ?? [];

        let text = `Action: ${action.name}\nID: ${action.id}\nModule: ${action.module}\n`;
        if (action.description) text += `Description: ${action.description}\n`;
        if (action.version) text += `Version: ${action.version}\n`;
        if (action.fqn) text += `FQN: ${action.fqn}\n`;
        if (action["output-type"])
          text += `Return type: ${action["output-type"]}\n`;

        if (inputParams.length > 0) {
          text += `\nInput Parameters:\n`;
          for (const p of inputParams) {
            text += `  • ${p.name} (${p.type})${p.description ? ` — ${p.description}` : ""}\n`;
          }
        }

        if (action.script) {
          text += `\nScript:\n\`\`\`javascript\n${action.script}\n\`\`\`\n`;
        }
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get action: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "create-action",
    {
      title: "Create Action",
      description:
        "Create a new action (scriptable task) in VCF Automation Orchestrator.",
      inputSchema: z.object({
        moduleName: z
          .string()
          .describe(
            "The module (package) name to create the action in (e.g. com.example.myactions)"
          ),
        name: z.string().describe("Name for the new action"),
        script: z
          .string()
          .describe("The JavaScript/TypeScript script content for the action"),
        inputParameters: z
          .array(
            z.object({
              name: z.string().describe("Parameter name"),
              type: z
                .string()
                .describe("Parameter type (e.g. string, number, boolean)"),
              description: z
                .string()
                .optional()
                .describe("Parameter description"),
            })
          )
          .optional()
          .describe("Input parameters for the action"),
        returnType: z
          .string()
          .optional()
          .describe("Return type (e.g. string, void, Array/string)"),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      moduleName,
      name,
      script,
      inputParameters,
      returnType,
    }): Promise<CallToolResult> => {
      try {
        const action = await client.createAction({
          moduleName,
          name,
          script,
          inputParameters: inputParameters as
            | { name: string; type: string; description?: string }[]
            | undefined,
          returnType,
        });
        return {
          content: [
            {
              type: "text",
              text: `Action created successfully.\nName: ${action.name}\nID: ${action.id}\nModule: ${action.module}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to create action: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
