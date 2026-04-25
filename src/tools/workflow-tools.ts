import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { VroClient } from "../vro-client.js";

export function registerWorkflowTools(
  server: McpServer,
  client: VroClient
): void {
  server.registerTool(
    "list-workflows",
    {
      title: "List Workflows",
      description:
        "List workflows from VCF Automation Orchestrator. Optionally filter by name substring.",
      inputSchema: z.object({
        filter: z
          .string()
          .optional()
          .describe("Filter workflows by name (substring match)"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ filter }): Promise<CallToolResult> => {
      try {
        const result = await client.listWorkflows(filter);
        const workflows = result.link ?? [];
        if (workflows.length === 0) {
          return {
            content: [
              { type: "text", text: "No workflows found." },
            ],
          };
        }
        const lines = workflows.map(
          (w) =>
            `• ${w.name} (id: ${w.id})${w.description ? ` — ${w.description}` : ""}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Found ${workflows.length} workflow(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list workflows: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "get-workflow",
    {
      title: "Get Workflow Details",
      description:
        "Get detailed information about a specific workflow including its input/output parameters.",
      inputSchema: z.object({
        id: z.string().describe("The workflow ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const wf = await client.getWorkflow(id);
        const inputParams = wf["input-parameters"] ?? [];
        const outputParams = wf["output-parameters"] ?? [];

        let text = `Workflow: ${wf.name}\nID: ${wf.id}\n`;
        if (wf.description) text += `Description: ${wf.description}\n`;
        if (wf.version) text += `Version: ${wf.version}\n`;
        if (wf.categoryName) text += `Category: ${wf.categoryName}\n`;

        if (inputParams.length > 0) {
          text += `\nInput Parameters:\n`;
          for (const p of inputParams) {
            text += `  • ${p.name} (${p.type})${p.description ? ` — ${p.description}` : ""}\n`;
          }
        }
        if (outputParams.length > 0) {
          text += `\nOutput Parameters:\n`;
          for (const p of outputParams) {
            text += `  • ${p.name} (${p.type})${p.description ? ` — ${p.description}` : ""}\n`;
          }
        }
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get workflow: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "create-workflow",
    {
      title: "Create Workflow",
      description:
        "Create a new empty workflow in VCF Automation Orchestrator. Use list-categories to find a category ID first.",
      inputSchema: z.object({
        categoryId: z
          .string()
          .describe("The category ID to create the workflow in"),
        name: z.string().describe("Name for the new workflow"),
        description: z
          .string()
          .optional()
          .describe("Optional description for the workflow"),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ categoryId, name, description }): Promise<CallToolResult> => {
      try {
        const wf = await client.createWorkflow(categoryId, name, description);
        return {
          content: [
            {
              type: "text",
              text: `Workflow created successfully.\nName: ${wf.name}\nID: ${wf.id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to create workflow: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "run-workflow",
    {
      title: "Run Workflow",
      description:
        "Execute a workflow. Optionally provide input parameters. Returns the execution ID which can be used with get-workflow-execution to check status.",
      inputSchema: z.object({
        id: z.string().describe("The workflow ID to execute"),
        inputs: z
          .array(
            z.object({
              name: z.string().describe("Parameter name"),
              type: z
                .string()
                .describe(
                  "Parameter type (e.g. string, number, boolean, Array/string)"
                ),
              value: z.unknown().describe("Parameter value"),
            })
          )
          .optional()
          .describe("Input parameters for the workflow execution"),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ id, inputs }): Promise<CallToolResult> => {
      try {
        const exec = await client.runWorkflow(id, inputs);
        return {
          content: [
            {
              type: "text",
              text: `Workflow execution started.\nExecution ID: ${exec.id}\nState: ${exec.state}\n\nUse get-workflow-execution to check progress.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to run workflow: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "get-workflow-execution",
    {
      title: "Get Workflow Execution",
      description:
        "Check the status and outputs of a workflow execution.",
      inputSchema: z.object({
        workflowId: z.string().describe("The workflow ID"),
        executionId: z.string().describe("The execution ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ workflowId, executionId }): Promise<CallToolResult> => {
      try {
        const exec = await client.getWorkflowExecution(
          workflowId,
          executionId
        );
        let text = `Execution: ${exec.id}\nState: ${exec.state}\n`;
        if (exec["start-date"]) text += `Started: ${exec["start-date"]}\n`;
        if (exec["end-date"]) text += `Ended: ${exec["end-date"]}\n`;
        if (exec["started-by"]) text += `Started by: ${exec["started-by"]}\n`;

        if (exec["content-exception"]) {
          text += `\nError: ${exec["content-exception"]}\n`;
        }

        const outputs = exec["output-parameters"] ?? [];
        if (outputs.length > 0) {
          text += `\nOutput Parameters:\n`;
          for (const p of outputs) {
            text += `  • ${p.name} (${p.type}): ${JSON.stringify(p.value)}\n`;
          }
        }
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get execution: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "delete-workflow",
    {
      title: "Delete Workflow",
      description:
        "Delete a workflow from VCF Automation Orchestrator. This action is irreversible.",
      inputSchema: z.object({
        id: z.string().describe("The workflow ID to delete"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        await client.deleteWorkflow(id);
        return {
          content: [
            {
              type: "text",
              text: `Workflow ${id} deleted successfully.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to delete workflow: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
