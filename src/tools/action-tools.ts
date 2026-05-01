import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { formatPreflightReport } from "../client/artifact-preflight.js";
import type { VroClient } from "../vro-client.js";

const actionDiffSourceSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("file"),
    fileName: z
      .string()
      .describe("Plain .action file name under the configured action artifact directory"),
  }),
  z.object({
    source: z.literal("live"),
    actionId: z.string().describe("Live action ID to export and compare"),
  }),
]);

export function registerActionTools(
  server: McpServer,
  client: VroClient,
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
            `• ${a.module}/${a.name} (id: ${a.id})${a.description ? ` — ${a.description}` : ""}`,
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
    },
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
    },
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
            "The module (package) name to create the action in (e.g. com.example.myactions)",
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
            }),
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
    },
  );

  server.registerTool(
    "export-action-file",
    {
      title: "Export Action File",
      description:
        "Export a vRO action as a .action file under the configured action artifact directory. The fileName must be a plain .action file name, not a path.",
      inputSchema: z.object({
        id: z.string().describe("The action ID to export"),
        fileName: z
          .string()
          .describe("Action file name to save under the configured action artifact directory"),
        overwrite: z
          .boolean()
          .optional()
          .describe("Overwrite the file if it already exists (default: false)"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, fileName, overwrite }): Promise<CallToolResult> => {
      try {
        const savedPath = await client.exportActionFile(
          id,
          fileName,
          overwrite ?? false,
        );
        return {
          content: [
            {
              type: "text",
              text: `Action ${id} exported successfully to: ${savedPath}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to export action file: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "preflight-action-file",
    {
      title: "Preflight Action File",
      description:
        "Validate a local .action artifact under the configured action artifact directory before importing it.",
      inputSchema: z.object({
        fileName: z
          .string()
          .describe("Action file name under the configured action artifact directory to validate"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ fileName }): Promise<CallToolResult> => {
      try {
        const report = await client.preflightActionFile(fileName);
        return {
          content: [{ type: "text", text: formatPreflightReport(report) }],
          isError: !report.valid,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to preflight action file: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "diff-action-file",
    {
      title: "Diff Action File",
      description:
        "Compare two local .action artifacts, or compare a live action export against a local .action artifact. The base is current/old and compare is proposed/new.",
      inputSchema: z.object({
        base: actionDiffSourceSchema.describe("Current/old action source"),
        compare: actionDiffSourceSchema.describe("Proposed/new action source"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ base, compare }): Promise<CallToolResult> => {
      try {
        const diff = await client.diffActionFile({ base, compare });
        return {
          content: [{ type: "text", text: diff }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to diff action file: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "import-action-file",
    {
      title: "Import Action File",
      description:
        "Import a .action file from the configured action artifact directory into an action category. Use list-categories with type ActionCategory to find the category name first. Set confirm to true to proceed.",
      inputSchema: z.object({
        categoryName: z
          .string()
          .describe("The action category/module name to import into"),
        fileName: z
          .string()
          .describe("Action file name under the configured action artifact directory to import"),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm import. If false, the import will not proceed.",
          ),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ categoryName, fileName, confirm }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm import of action file ${fileName} from ${client.getActionDirectory()} into ${categoryName} by setting confirm to true.`,
            },
          ],
        };
      }
      try {
        await client.importActionFile(categoryName, fileName);
        return {
          content: [
            {
              type: "text",
              text: `Action imported successfully from: ${fileName}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to import action file: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "delete-action",
    {
      title: "Delete Action",
      description:
        "Delete an action (scriptable task) from VCF Automation Orchestrator. This action is irreversible. Set confirm to true to proceed.",
      inputSchema: z.object({
        id: z.string().describe("The action ID to delete"),
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
              text: `Confirm deletion of action ${id} by setting confirm to true. This action is irreversible.`,
            },
          ],
        };
      }
      try {
        await client.deleteAction(id);
        return {
          content: [
            {
              type: "text",
              text: `Action ${id} deleted successfully.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to delete action: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
