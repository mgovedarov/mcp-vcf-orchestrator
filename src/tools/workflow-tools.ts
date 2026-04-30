import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type {
  SimpleParameter,
  VroParameter,
  Workflow,
  WorkflowExecution,
  WorkflowExecutionLog,
  WorkflowExecutionStackItem,
} from "../types.js";
import type { VroClient } from "../vro-client.js";

const DEFAULT_WORKFLOW_WAIT_TIMEOUT_SECONDS = 300;
const DEFAULT_WORKFLOW_POLL_INTERVAL_SECONDS = 2;
const DEFAULT_WORKFLOW_LOG_LIMIT = 20;

const workflowExecutionStatusMap = {
  running: "RUNNING",
  completed: "COMPLETED",
  failed: "FAILED",
  canceled: "CANCELED",
  "waiting-signal": "STATE_WAITING_ON_SIGNAL",
} as const;

export function getWorkflowInputParameters(workflow: Workflow): VroParameter[] {
  return workflow.inputParameters ?? workflow["input-parameters"] ?? [];
}

export function getWorkflowOutputParameters(workflow: Workflow): VroParameter[] {
  return workflow.outputParameters ?? workflow["output-parameters"] ?? [];
}

export function getExecutionOutputParameters(execution: WorkflowExecution): VroParameter[] {
  return execution.outputParameters ?? execution["output-parameters"] ?? [];
}

export function unwrapVroParameterValue(parameter: VroParameter): unknown {
  const value = parameter.value;
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }

  const byType = value[parameter.type];
  if (hasValueProperty(byType)) {
    return byType.value;
  }

  const entries = Object.values(value);
  if (entries.length === 1 && hasValueProperty(entries[0])) {
    return entries[0].value;
  }

  return value;
}

function hasValueProperty(value: unknown): value is { value: unknown } {
  return typeof value === "object" && value !== null && "value" in value;
}

function getWorkflowExecutionStackItems(
  execution: WorkflowExecution
): WorkflowExecutionStackItem[] {
  return (
    execution.executionStack ??
    execution["execution-stack"] ??
    execution.workflowItem ??
    execution["workflow-item"] ??
    []
  );
}

function normalizeExecutionState(state: string | undefined): string {
  return (state ?? "").replaceAll("-", "_").toUpperCase();
}

function isCompletedState(state: string | undefined): boolean {
  return normalizeExecutionState(state) === "COMPLETED";
}

function isFailureState(state: string | undefined): boolean {
  return ["FAILED", "CANCELED", "CANCELLED"].includes(
    normalizeExecutionState(state)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringifyValue(value: unknown): string {
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

function validateParameterValue(type: string, value: unknown): string | null {
  if (value === undefined) {
    return "is missing a value";
  }

  const normalizedType = type.toLowerCase();
  if (normalizedType === "string" && typeof value !== "string") {
    return `must be a string for type ${type}`;
  }
  if (
    normalizedType === "number" &&
    (typeof value !== "number" || !Number.isFinite(value))
  ) {
    return `must be a finite number for type ${type}`;
  }
  if (normalizedType === "boolean" && typeof value !== "boolean") {
    return `must be a boolean for type ${type}`;
  }
  if (normalizedType.startsWith("array/") && !Array.isArray(value)) {
    return `must be an array for type ${type}`;
  }

  return null;
}

function validateWorkflowRunInputs(
  workflow: Workflow,
  inputs: { name: string; type?: string; value?: unknown }[] = []
): { errors: string[]; inputs: SimpleParameter[] } {
  const errors: string[] = [];
  const definitions = getWorkflowInputParameters(workflow);
  const definitionsByName = new Map(definitions.map((p) => [p.name, p]));
  const seen = new Set<string>();
  const normalizedInputs: SimpleParameter[] = [];

  for (const input of inputs) {
    if (seen.has(input.name)) {
      errors.push(`Duplicate input: ${input.name}`);
      continue;
    }
    seen.add(input.name);

    const definition = definitionsByName.get(input.name);
    if (!definition) {
      errors.push(`Unknown input: ${input.name}`);
      continue;
    }

    if (input.type !== undefined && input.type !== definition.type) {
      errors.push(
        `Input ${input.name} type ${input.type} does not match workflow type ${definition.type}`
      );
    }

    const valueError = validateParameterValue(definition.type, input.value);
    if (valueError) {
      errors.push(`Input ${input.name} ${valueError}`);
    }

    normalizedInputs.push({
      name: input.name,
      type: definition.type,
      value: input.value,
    });
  }

  for (const definition of definitions) {
    if (definition.value === undefined && !seen.has(definition.name)) {
      errors.push(
        `Missing required input: ${definition.name} (${definition.type})`
      );
    }
  }

  return { errors, inputs: normalizedInputs };
}

function formatValidationErrors(workflow: Workflow, errors: string[]): string {
  return [
    `Workflow input validation failed for ${workflow.name} (${workflow.id}).`,
    "",
    ...errors.map((error) => `• ${error}`),
  ].join("\n");
}

function formatOutputParameters(execution: WorkflowExecution): string {
  const outputs = getExecutionOutputParameters(execution);
  if (outputs.length === 0) {
    return "Output Parameters: none";
  }

  const lines = outputs.map(
    (p) =>
      `  • ${p.name} (${p.type}): ${stringifyValue(unwrapVroParameterValue(p))}`
  );
  return `Output Parameters:\n${lines.join("\n")}`;
}

function formatExecutionHeader(
  title: string,
  workflow: Workflow,
  execution: WorkflowExecution,
  elapsedMs?: number
): string {
  let text = `${title}\nWorkflow: ${workflow.name}\nWorkflow ID: ${workflow.id}\nExecution ID: ${execution.id}\nState: ${execution.state}\n`;
  if (execution["start-date"]) text += `Started: ${execution["start-date"]}\n`;
  if (execution["end-date"]) text += `Ended: ${execution["end-date"]}\n`;
  if (execution["started-by"]) text += `Started by: ${execution["started-by"]}\n`;
  if (elapsedMs !== undefined) {
    text += `Elapsed wait: ${Math.round(elapsedMs / 1000)}s\n`;
  }
  return text.trimEnd();
}

function formatStackItem(item: WorkflowExecutionStackItem): string {
  const label =
    item.displayName ?? item.name ?? item.workflowDisplayName ?? item.href ?? "Unnamed item";
  const details: string[] = [];
  if (item.name && item.name !== label) details.push(`name: ${item.name}`);
  if (item.workflowDisplayName) {
    details.push(`workflow: ${item.workflowDisplayName}`);
  }
  return details.length > 0 ? `${label} (${details.join(", ")})` : label;
}

function formatLogEntry(log: WorkflowExecutionLog): string {
  const prefix = [
    log["time-stamp"],
    log.severity ? `[${log.severity}]` : undefined,
    log.origin,
  ].filter(Boolean);
  const shortDescription = log["short-description"];
  const longDescription = log["long-description"];
  const description =
    shortDescription && longDescription && shortDescription !== longDescription
      ? `${shortDescription} — ${longDescription}`
      : shortDescription ?? longDescription ?? "(no description)";
  return `${prefix.length > 0 ? `${prefix.join(" ")} ` : ""}${description}`;
}

function appendDiagnostics(
  text: string,
  execution: WorkflowExecution,
  logs: WorkflowExecutionLog[],
  warnings: string[]
): string {
  let result = text;
  if (execution["business-state"]) {
    result += `\nBusiness state: ${execution["business-state"]}`;
  }
  if (execution["current-item-display-name"]) {
    result += `\nCurrent item: ${execution["current-item-display-name"]}`;
  } else if (execution["current-item-for-display"]) {
    result += `\nCurrent item: ${execution["current-item-for-display"]}`;
  }
  if (execution["content-exception"]) {
    result += `\n\nError: ${execution["content-exception"]}`;
  }

  const stackItems = getWorkflowExecutionStackItems(execution);
  if (stackItems.length > 0) {
    result += `\n\nExecution Stack:\n${stackItems
      .slice(0, 5)
      .map((item) => `  • ${formatStackItem(item)}`)
      .join("\n")}`;
  }

  if (logs.length > 0) {
    result += `\n\nLog Excerpts:\n${logs
      .map((log) => `  • ${formatLogEntry(log)}`)
      .join("\n")}`;
  }

  if (warnings.length > 0) {
    result += `\n\nWarnings:\n${warnings
      .map((warning) => `  • ${warning}`)
      .join("\n")}`;
  }

  return result;
}

async function collectExecutionDiagnostics(
  client: VroClient,
  workflowId: string,
  execution: WorkflowExecution,
  logLimit: number
): Promise<{
  execution: WorkflowExecution;
  logs: WorkflowExecutionLog[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  let detailedExecution = execution;

  try {
    detailedExecution = await client.getWorkflowExecution(
      workflowId,
      execution.id,
      { showDetails: true }
    );
  } catch (error) {
    warnings.push(`Unable to fetch detailed execution data: ${errorMessage(error)}`);
  }

  let logs: WorkflowExecutionLog[] = [];
  if (logLimit > 0) {
    try {
      logs =
        (
          await client.getWorkflowExecutionLogs(workflowId, execution.id, {
            maxResult: logLimit,
          })
        ).logs ?? [];
    } catch (error) {
      warnings.push(`Unable to fetch execution logs: ${errorMessage(error)}`);
    }
  }

  return { execution: detailedExecution, logs, warnings };
}

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
        const inputParams = getWorkflowInputParameters(wf);
        const outputParams = getWorkflowOutputParameters(wf);

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
    "run-workflow-and-wait",
    {
      title: "Run Workflow and Wait",
      description:
        "Validate inputs, execute a workflow, poll until completion/failure/timeout, and return outputs or useful failure diagnostics.",
      inputSchema: z.object({
        id: z.string().describe("The workflow ID to execute"),
        inputs: z
          .array(
            z.object({
              name: z.string().describe("Parameter name"),
              type: z
                .string()
                .optional()
                .describe(
                  "Optional parameter type. If omitted, the workflow definition type is used."
                ),
              value: z.unknown().describe("Parameter value"),
            })
          )
          .optional()
          .describe("Input parameters for the workflow execution"),
        timeoutSeconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum time to wait for completion (default: 300)"),
        pollIntervalSeconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Seconds between execution status polls (default: 2)"),
        logLimit: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Maximum execution log entries to include on failure or timeout (default: 20)"),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      id,
      inputs,
      timeoutSeconds,
      pollIntervalSeconds,
      logLimit,
    }): Promise<CallToolResult> => {
      let startedExecution: WorkflowExecution | undefined;
      try {
        const workflow = await client.getWorkflow(id);
        const validation = validateWorkflowRunInputs(workflow, inputs ?? []);
        if (validation.errors.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: formatValidationErrors(workflow, validation.errors),
              },
            ],
            isError: true,
          };
        }

        const timeoutMs = Math.max(
          0,
          (timeoutSeconds ?? DEFAULT_WORKFLOW_WAIT_TIMEOUT_SECONDS) * 1000
        );
        const pollIntervalMs = Math.max(
          0,
          (pollIntervalSeconds ?? DEFAULT_WORKFLOW_POLL_INTERVAL_SECONDS) * 1000
        );
        const maxLogs = Math.max(0, logLimit ?? DEFAULT_WORKFLOW_LOG_LIMIT);
        const waitStartedAt = Date.now();
        const deadline = waitStartedAt + timeoutMs;

        startedExecution = await client.runWorkflow(id, validation.inputs);
        if (!startedExecution.id) {
          throw new Error("Workflow execution did not return an execution ID");
        }

        let lastExecution = startedExecution;
        while (true) {
          lastExecution = await client.getWorkflowExecution(
            id,
            startedExecution.id
          );

          if (isCompletedState(lastExecution.state)) {
            const elapsedMs = Date.now() - waitStartedAt;
            const text = [
              formatExecutionHeader(
                "Workflow execution completed.",
                workflow,
                lastExecution,
                elapsedMs
              ),
              "",
              formatOutputParameters(lastExecution),
            ].join("\n");
            return { content: [{ type: "text", text }] };
          }

          if (isFailureState(lastExecution.state)) {
            const elapsedMs = Date.now() - waitStartedAt;
            const diagnostics = await collectExecutionDiagnostics(
              client,
              id,
              lastExecution,
              maxLogs
            );
            const text = appendDiagnostics(
              formatExecutionHeader(
                "Workflow execution failed.",
                workflow,
                diagnostics.execution,
                elapsedMs
              ),
              diagnostics.execution,
              diagnostics.logs,
              diagnostics.warnings
            );
            return { content: [{ type: "text", text }], isError: true };
          }

          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) {
            const elapsedMs = Date.now() - waitStartedAt;
            const diagnostics = await collectExecutionDiagnostics(
              client,
              id,
              lastExecution,
              maxLogs
            );
            const text = appendDiagnostics(
              formatExecutionHeader(
                "Workflow execution timed out while waiting.",
                workflow,
                diagnostics.execution,
                elapsedMs
              ) +
                `\nTimeout: ${Math.round(timeoutMs / 1000)}s\nThe remote workflow was not canceled.`,
              diagnostics.execution,
              diagnostics.logs,
              diagnostics.warnings
            );
            return { content: [{ type: "text", text }], isError: true };
          }

          await sleep(Math.min(pollIntervalMs, remainingMs));
        }
      } catch (error) {
        const prefix = startedExecution?.id
          ? `Workflow execution ${startedExecution.id} started, but the wait loop failed`
          : "Failed to run workflow and wait";
        return {
          content: [
            {
              type: "text",
              text: `${prefix}: ${errorMessage(error)}`,
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

        const outputs = getExecutionOutputParameters(exec);
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
    "list-workflow-executions",
    {
      title: "List Workflow Executions",
      description:
        "List past and current executions for a specific workflow. Use this to find an execution ID before calling get-workflow-execution.",
      inputSchema: z.object({
        workflowId: z.string().describe("The workflow ID"),
        maxResults: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of executions to return (default: 20)"),
        status: z
          .enum(["running", "completed", "failed", "canceled", "waiting-signal"])
          .optional()
          .describe("Filter executions by status"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ workflowId, maxResults, status }): Promise<CallToolResult> => {
      try {
        const result = await client.listWorkflowExecutions(workflowId, {
          maxResults,
          status: status ? workflowExecutionStatusMap[status] : undefined,
        });
        const executions = result.relations?.link ?? [];
        if (executions.length === 0) {
          return {
            content: [{ type: "text", text: "No executions found." }],
          };
        }
        const lines = executions.map((e) => {
          let line = `• ${e.state.toUpperCase()} (id: ${e.id})`;
          if (e["start-date"]) line += ` — started: ${e["start-date"]}`;
          if (e["end-date"]) line += `, ended: ${e["end-date"]}`;
          if (e["started-by"]) line += ` [by: ${e["started-by"]}]`;
          return line;
        });
        const total = result.total ?? executions.length;
        return {
          content: [
            {
              type: "text",
              text: `Found ${total} execution(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list executions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "export-workflow-file",
    {
      title: "Export Workflow File",
      description:
        "Export a vRO workflow as a .workflow file under VCFA_WORKFLOW_DIR. The fileName must be a plain .workflow file name, not a path.",
      inputSchema: z.object({
        id: z.string().describe("The workflow ID to export"),
        fileName: z
          .string()
          .describe("Workflow file name to save under VCFA_WORKFLOW_DIR"),
        overwrite: z
          .boolean()
          .optional()
          .describe("Overwrite the file if it already exists (default: false)"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, fileName, overwrite }): Promise<CallToolResult> => {
      try {
        const savedPath = await client.exportWorkflowFile(
          id,
          fileName,
          overwrite ?? false
        );
        return {
          content: [
            {
              type: "text",
              text: `Workflow ${id} exported successfully to: ${savedPath}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to export workflow file: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "import-workflow-file",
    {
      title: "Import Workflow File",
      description:
        "Import a .workflow file from VCFA_WORKFLOW_DIR into a workflow category. Use list-categories with type WorkflowCategory to find a category ID first. Set confirm to true to proceed.",
      inputSchema: z.object({
        categoryId: z
          .string()
          .describe("The workflow category ID to import into"),
        fileName: z
          .string()
          .describe("Workflow file name under VCFA_WORKFLOW_DIR to import"),
        overwrite: z
          .boolean()
          .optional()
          .describe("Overwrite an existing workflow with the same identity (default: true)"),
        confirm: z
          .boolean()
          .describe("Must be set to true to confirm import. If false, the import will not proceed."),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ categoryId, fileName, overwrite, confirm }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm import of workflow file ${fileName} from ${client.getWorkflowDirectory()} by setting confirm to true.`,
            },
          ],
        };
      }
      try {
        await client.importWorkflowFile(categoryId, fileName, overwrite ?? true);
        return {
          content: [
            {
              type: "text",
              text: `Workflow imported successfully from: ${fileName}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to import workflow file: ${error instanceof Error ? error.message : String(error)}`,
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
        "Delete a workflow from VCF Automation Orchestrator. This action is irreversible. Set confirm to true to proceed.",
      inputSchema: z.object({
        id: z.string().describe("The workflow ID to delete"),
        confirm: z.boolean().describe("Must be set to true to confirm deletion. If false, the deletion will not proceed."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id, confirm }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm deletion of workflow ${id} by setting confirm to true. This action is irreversible.`,
            },
          ],
        };
      }
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
