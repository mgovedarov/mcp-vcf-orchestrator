import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { VroClient } from "../vro-client.js";

export function registerResourceTools(
  server: McpServer,
  client: VroClient
): void {
  server.registerTool(
    "list-resource-elements",
    {
      title: "List Resource Elements",
      description:
        "List resource elements from VCF Automation Orchestrator. Optionally filter by name.",
      inputSchema: z.object({
        filter: z
          .string()
          .optional()
          .describe("Filter resource elements by name (substring match)"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ filter }): Promise<CallToolResult> => {
      try {
        const result = await client.listResources(filter);
        const resources = result.link ?? [];
        if (resources.length === 0) {
          return {
            content: [{ type: "text", text: "No resource elements found." }],
          };
        }
        const lines = resources.map((r) => {
          let line = `• ${r.name} (id: ${r.id})`;
          if (r.mimeType) line += ` [${r.mimeType}]`;
          if (r.categoryName) line += ` — category: ${r.categoryName}`;
          else if (r.categoryId) line += ` — categoryId: ${r.categoryId}`;
          if (r.description) line += ` — ${r.description}`;
          return line;
        });
        return {
          content: [
            {
              type: "text",
              text: `Found ${resources.length} resource element(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list resource elements: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "export-resource-element",
    {
      title: "Export Resource Element",
      description:
        "Export a vRO resource element by ID to a file under VCFA_RESOURCE_DIR. The fileName must be a plain file name, not a path.",
      inputSchema: z.object({
        id: z.string().describe("The resource element ID to export"),
        fileName: z
          .string()
          .describe("File name to save under VCFA_RESOURCE_DIR"),
        overwrite: z
          .boolean()
          .optional()
          .describe("Overwrite the file if it already exists (default: false)"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, fileName, overwrite }): Promise<CallToolResult> => {
      try {
        const savedPath = await client.exportResource(id, fileName, overwrite ?? false);
        return {
          content: [
            {
              type: "text",
              text: `Resource element ${id} exported successfully to: ${savedPath}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to export resource element: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "import-resource-element",
    {
      title: "Import Resource Element",
      description:
        "Import a vRO resource element from VCFA_RESOURCE_DIR into a ResourceElementCategory. Use list-categories with type ResourceElementCategory to find a category ID first. Set confirm to true to proceed.",
      inputSchema: z.object({
        categoryId: z
          .string()
          .describe("The resource element category ID to import into"),
        fileName: z
          .string()
          .describe("File name under VCFA_RESOURCE_DIR to import"),
        confirm: z
          .boolean()
          .describe("Must be set to true to confirm import. If false, the import will not proceed."),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ categoryId, fileName, confirm }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm import of resource file ${fileName} from ${client.getResourceDirectory()} by setting confirm to true.`,
            },
          ],
        };
      }
      try {
        await client.importResource(categoryId, fileName);
        return {
          content: [
            {
              type: "text",
              text: `Resource element imported successfully from: ${fileName}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to import resource element: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "update-resource-element",
    {
      title: "Update Resource Element Content",
      description:
        "Update an existing resource element's binary content from a file under VCFA_RESOURCE_DIR.",
      inputSchema: z.object({
        id: z.string().describe("The resource element ID to update"),
        fileName: z
          .string()
          .describe("File name under VCFA_RESOURCE_DIR containing the replacement content"),
        changesetSha: z
          .string()
          .optional()
          .describe("Optional X-VRO-Changeset-Sha value for version-controlled content"),
        confirm: z
          .boolean()
          .describe("Must be set to true to confirm update. If false, the update will not proceed."),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ id, fileName, changesetSha, confirm }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm update of resource element ${id} from ${fileName} by setting confirm to true.`,
            },
          ],
        };
      }
      try {
        await client.updateResourceContent(id, fileName, changesetSha);
        return {
          content: [
            {
              type: "text",
              text: `Resource element ${id} updated successfully from: ${fileName}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to update resource element: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "delete-resource-element",
    {
      title: "Delete Resource Element",
      description:
        "Delete a resource element from VCF Automation Orchestrator. Set force to true to delete a resource that is referenced by workflows. Set confirm to true to proceed.",
      inputSchema: z.object({
        id: z.string().describe("The resource element ID to delete"),
        force: z
          .boolean()
          .optional()
          .describe("Delete even if the resource is referenced by workflows (default: false)"),
        confirm: z
          .boolean()
          .describe("Must be set to true to confirm deletion. If false, the deletion will not proceed."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id, force, confirm }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm deletion of resource element ${id} by setting confirm to true. This action is irreversible.`,
            },
          ],
        };
      }
      try {
        await client.deleteResource(id, force ?? false);
        return {
          content: [
            {
              type: "text",
              text: `Resource element ${id} deleted successfully${force ? " with force" : ""}.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to delete resource element: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
