import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type {
  DeploymentAction,
  DeploymentActionList,
  DeploymentRequest,
} from "../types.js";
import type { VroClient } from "../vro-client.js";

function isInputArray(value: unknown): value is {
  name?: string;
  label?: string;
  type?: string;
  description?: string;
  required?: boolean;
}[] {
  return Array.isArray(value);
}

function getDeploymentActionInputHints(action: DeploymentAction): string[] {
  const inputSource = action.inputParameters ?? action.inputs;
  if (isInputArray(inputSource)) {
    return inputSource
      .map((input) => {
        const name = input.name ?? input.label;
        if (!name) return undefined;
        let hint = `${name}`;
        if (input.type) hint += ` (${input.type})`;
        if (input.required) hint += " required";
        if (input.description) hint += ` — ${input.description}`;
        return hint;
      })
      .filter((hint): hint is string => Boolean(hint));
  }

  if (inputSource && typeof inputSource === "object") {
    return Object.keys(inputSource);
  }

  return [];
}

function normalizeDeploymentActionList(result: DeploymentActionList): {
  actions: DeploymentAction[];
  total: number;
} {
  if (Array.isArray(result)) {
    return { actions: result, total: result.length };
  }

  const actions = result.content ?? [];
  return { actions, total: result.totalElements ?? actions.length };
}

export function formatDeploymentActions(
  deploymentId: string,
  actions: DeploymentAction[],
  total = actions.length,
): string {
  if (actions.length === 0) {
    return `No deployment actions found for deployment ${deploymentId}.`;
  }

  const lines = actions.map((action) => {
    const name = action.name ?? action.displayName ?? action.id;
    let line = `• ${name} (id: ${action.id})`;
    if (action.description) line += ` — ${action.description}`;

    const inputHints = getDeploymentActionInputHints(action);
    if (inputHints.length > 0) {
      line += `\n  inputs: ${inputHints.join(", ")}`;
    }
    return line;
  });

  return `Found ${total} deployment action(s) for deployment ${deploymentId}:\n\n${lines.join("\n")}`;
}

export function formatDeploymentRequest(request: DeploymentRequest): string {
  let text = "Deployment action request submitted.\n";
  if (request.id) text += `ID: ${request.id}\n`;
  if (request.name) text += `Name: ${request.name}\n`;
  if (request.actionId) text += `Action ID: ${request.actionId}\n`;
  if (request.deploymentId) text += `Deployment ID: ${request.deploymentId}\n`;
  if (request.status) text += `Status: ${request.status}\n`;
  if (request.details) text += `Details: ${request.details}\n`;
  return text;
}

export function registerDeploymentTools(
  server: McpServer,
  client: VroClient,
): void {
  server.registerTool(
    "list-deployments",
    {
      title: "List Deployments",
      description:
        "List deployments in VCF Automation. Optionally filter by name/keyword search or by project ID.",
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe("Search deployments by name or keyword"),
        projectId: z
          .string()
          .optional()
          .describe("Filter deployments by project ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ search, projectId }): Promise<CallToolResult> => {
      try {
        const result = await client.listDeployments(search, projectId);
        const items = result.content ?? [];
        if (items.length === 0) {
          return {
            content: [{ type: "text", text: "No deployments found." }],
          };
        }
        const lines = items.map((d) => {
          let line = `• ${d.name} (id: ${d.id})`;
          if (d.status) line += ` [${d.status}]`;
          if (d.projectName) line += ` — project: ${d.projectName}`;
          else if (d.projectId) line += ` — projectId: ${d.projectId}`;
          return line;
        });
        const total = result.totalElements ?? items.length;
        return {
          content: [
            {
              type: "text",
              text: `Found ${total} deployment(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list deployments: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get-deployment",
    {
      title: "Get Deployment",
      description:
        "Get detailed information about a specific deployment by its ID.",
      inputSchema: z.object({
        id: z.string().describe("The deployment ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const d = await client.getDeployment(id);
        let text = `Deployment: ${d.name}\nID: ${d.id}\n`;
        if (d.status) text += `Status: ${d.status}\n`;
        if (d.description) text += `Description: ${d.description}\n`;
        if (d.projectName) text += `Project: ${d.projectName}\n`;
        else if (d.projectId) text += `Project ID: ${d.projectId}\n`;
        if (d.catalogItemId) text += `Catalog Item ID: ${d.catalogItemId}\n`;
        if (d.catalogItemVersion)
          text += `Catalog Item Version: ${d.catalogItemVersion}\n`;
        if (d.ownedBy) text += `Owned By: ${d.ownedBy}\n`;
        if (d.createdBy) text += `Created By: ${d.createdBy}\n`;
        if (d.createdAt) text += `Created At: ${d.createdAt}\n`;
        if (d.lastUpdatedBy) text += `Last Updated By: ${d.lastUpdatedBy}\n`;
        if (d.lastUpdatedAt) text += `Last Updated At: ${d.lastUpdatedAt}\n`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get deployment: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "delete-deployment",
    {
      title: "Delete Deployment",
      description:
        "Delete a deployment by its ID. Set confirm to true to proceed.",
      inputSchema: z.object({
        id: z.string().describe("The deployment ID to delete"),
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
              text: `Confirm deletion of deployment ${id} by setting confirm to true. This action is irreversible.`,
            },
          ],
        };
      }
      try {
        await client.deleteDeployment(id);
        return {
          content: [
            { type: "text", text: `Deployment ${id} deleted successfully.` },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to delete deployment: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "create-deployment",
    {
      title: "Create Deployment",
      description:
        "Create a new deployment from a catalog item. Use list-catalog-items to find the catalog item ID, and list-deployments to verify afterwards.",
      inputSchema: z.object({
        catalogItemId: z.string().describe("The catalog item ID to deploy"),
        deploymentName: z.string().describe("Name for the new deployment"),
        projectId: z
          .string()
          .describe("The project ID in which to create the deployment"),
        version: z
          .string()
          .optional()
          .describe("Catalog item version to deploy (defaults to latest)"),
        reason: z
          .string()
          .optional()
          .describe("Reason or comment for the deployment request"),
        inputs: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Catalog item input parameters as a key/value object"),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      catalogItemId,
      deploymentName,
      projectId,
      version,
      reason,
      inputs,
    }): Promise<CallToolResult> => {
      try {
        const deployment = await client.createDeploymentFromCatalogItem({
          catalogItemId,
          deploymentName,
          projectId,
          version,
          reason,
          inputs,
        });
        let text = `Deployment request submitted.\n`;
        if (deployment.id) text += `ID: ${deployment.id}\n`;
        if (deployment.name) text += `Name: ${deployment.name}\n`;
        if (deployment.status) text += `Status: ${deployment.status}\n`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to create deployment: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "list-deployment-actions",
    {
      title: "List Deployment Actions",
      description:
        "List deployment-level day-2 actions available for a VCF Automation deployment.",
      inputSchema: z.object({
        deploymentId: z.string().describe("The deployment ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ deploymentId }): Promise<CallToolResult> => {
      try {
        const result = await client.listDeploymentActions(deploymentId);
        const { actions, total } = normalizeDeploymentActionList(result);
        return {
          content: [
            {
              type: "text",
              text: formatDeploymentActions(deploymentId, actions, total),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list deployment actions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "run-deployment-action",
    {
      title: "Run Deployment Action",
      description:
        "Run a deployment-level day-2 action. Use list-deployment-actions first to find the action ID and any required inputs. Set confirm to true to proceed.",
      inputSchema: z.object({
        deploymentId: z.string().describe("The deployment ID"),
        actionId: z.string().describe("The deployment action ID to run"),
        reason: z
          .string()
          .optional()
          .describe("Reason for requesting the day-2 action"),
        inputs: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Day-2 action inputs as a key/value object"),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm the day-2 action request. If false, the request will not be submitted.",
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({
      deploymentId,
      actionId,
      reason,
      inputs,
      confirm,
    }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm running deployment action ${actionId} on deployment ${deploymentId} by setting confirm to true. Day-2 actions may change or delete deployment resources.`,
            },
          ],
        };
      }

      try {
        const request = await client.runDeploymentAction({
          deploymentId,
          actionId,
          reason,
          inputs,
        });
        return {
          content: [{ type: "text", text: formatDeploymentRequest(request) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to run deployment action: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
