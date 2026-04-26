import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { VroClient } from "../vro-client.js";

export function registerDeploymentTools(
  server: McpServer,
  client: VroClient
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
    }
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
        if (d.catalogItemVersion) text += `Catalog Item Version: ${d.catalogItemVersion}\n`;
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
    }
  );

  server.registerTool(
    "delete-deployment",
    {
      title: "Delete Deployment",
      description: "Delete a deployment by its ID. Set confirm to true to proceed.",
      inputSchema: z.object({
        id: z.string().describe("The deployment ID to delete"),
        confirm: z.boolean().describe("Must be set to true to confirm deletion. If false, the deletion will not proceed."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id, confirm }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [{ type: "text", text: `Confirm deletion of deployment ${id} by setting confirm to true. This action is irreversible.` }],
        };
      }
      try {
        await client.deleteDeployment(id);
        return {
          content: [{ type: "text", text: `Deployment ${id} deleted successfully.` }],
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
    }
  );

  server.registerTool(
    "create-deployment",
    {
      title: "Create Deployment",
      description:
        "Create a new deployment from a catalog item. Use list-catalog-items to find the catalog item ID, and list-deployments to verify afterwards.",
      inputSchema: z.object({
        catalogItemId: z
          .string()
          .describe("The catalog item ID to deploy"),
        deploymentName: z
          .string()
          .describe("Name for the new deployment"),
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
          .record(z.unknown())
          .optional()
          .describe("Catalog item input parameters as a key/value object"),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ catalogItemId, deploymentName, projectId, version, reason, inputs }): Promise<CallToolResult> => {
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
    }
  );
}
