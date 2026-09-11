import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { VroClient } from "../vro-client.js";
import { truncationNote } from "./truncation.js";
import { listLimitSchema, limitNote } from "./list-limit.js";
import { DESTRUCTIVE_LIVE_WRITE } from "./annotations.js";
import {
  appendGuardGuidance,
  guardExpectedCategory,
  guardExpectedFields,
  hasAnyExpectedValue,
} from "./confirmation-guards.js";

/**
 * Verify a resource element against `expectedName` / `expectedCategoryName`
 * before a live mutation.
 *
 * The category needs its own handling because the live listing may not carry
 * one. `getResourceElement` resolves the element from `GET /resources`, and on
 * vRO 8.18.1 that listing returns only `description`, `id`, `name` and
 * `version` per element -- no `categoryName` at all (verified on the wire,
 * VCFO-077). Feeding that absence straight into `guardExpectedFields` reports
 * every value as a mismatch against "(missing)", so supplying the argument
 * refused a legitimate update or delete no matter what the caller passed.
 *
 * Absence is therefore reported as "cannot verify here" rather than as a
 * mismatch, and it still refuses: a caller who explicitly asked for two-phase
 * verification must not be told the target was confirmed when it was not. The
 * check keys on the missing datum rather than on `targetPlatform`, so it stays
 * correct wherever the listing does carry a category.
 */
function guardResourceTarget(
  id: string,
  resource: { name?: string; categoryName?: string },
  expectedName: string | undefined,
  expectedCategoryName: string | undefined,
): CallToolResult | undefined {
  if (expectedCategoryName !== undefined && resource.categoryName === undefined) {
    return {
      content: [
        {
          type: "text",
          text: `Cannot verify expectedCategoryName for resource element ${id}: this environment's resource listing does not report a category for its elements, so the value cannot be confirmed either way. No live mutation was performed. Omit expectedCategoryName and confirm placement with list-resource-elements, or re-run with expectedName only.`,
        },
      ],
      isError: true,
    };
  }

  return guardExpectedFields(`resource element ${id}`, [
    {
      label: "resource name",
      expected: expectedName,
      actual: resource.name,
    },
    {
      label: "category name",
      expected: expectedCategoryName,
      actual: resource.categoryName,
    },
  ]);
}

export function registerResourceTools(
  server: McpServer,
  client: VroClient,
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
        limit: listLimitSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ filter, limit }): Promise<CallToolResult> => {
      try {
        const result = await client.listResources(filter, { limit });
        const resources = result.link ?? [];
        if (resources.length === 0) {
          return {
            content: [{ type: "text", text: `No resource elements found.${limit !== undefined ? truncationNote(result, 0, result.total) : ""}` }],
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
              text: `Found ${resources.length} resource element(s):\n\n${lines.join("\n")}${truncationNote(result, resources.length, result.total)}${limitNote(result, resources.length, result.total)}`,
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
    },
  );

  server.registerTool(
    "export-resource-element",
    {
      title: "Export Resource Element",
      description:
        "Export a vRO resource element by ID to a file under the configured resource artifact directory. The fileName must be a plain file name, not a path.",
      inputSchema: z.object({
        id: z.string().describe("The resource element ID to export"),
        fileName: z
          .string()
          .describe("File name to save under the configured resource artifact directory"),
        overwrite: z
          .boolean()
          .optional()
          .describe("Overwrite the file if it already exists (default: false)"),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ id, fileName, overwrite }): Promise<CallToolResult> => {
      try {
        const savedPath = await client.exportResource(
          id,
          fileName,
          overwrite ?? false,
        );
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
    },
  );

  server.registerTool(
    "import-resource-element",
    {
      title: "Import Resource Element",
      description:
        "Import a vRO resource element from the configured resource artifact directory into a ResourceElementCategory. Use list-categories with type ResourceElementCategory to find a category ID first. Set confirm to true to proceed.",
      inputSchema: z.object({
        categoryId: z
          .string()
          .describe("The resource element category ID to import into"),
        fileName: z
          .string()
          .describe("File name under the configured resource artifact directory to import"),
        expectedCategoryId: z
          .string()
          .optional()
          .describe(
            "Optional expected resource category ID; must match categoryId before import",
          ),
        expectedCategoryName: z
          .string()
          .optional()
          .describe(
            "Optional expected resource category name verified before import",
          ),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm import. If false, the import will not proceed.",
          ),
      }),
      annotations: DESTRUCTIVE_LIVE_WRITE,
    },
    async ({
      categoryId,
      fileName,
      expectedCategoryId,
      expectedCategoryName,
      confirm,
    }): Promise<CallToolResult> => {
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
        const categoryIdGuard = guardExpectedFields(
          `resource import target ${categoryId}`,
          [
            {
              label: "category ID",
              expected: expectedCategoryId,
              actual: categoryId,
            },
          ],
        );
        if (categoryIdGuard) return categoryIdGuard;

        if (expectedCategoryName !== undefined) {
          const categoryNameGuard = await guardExpectedCategory(
            `resource import target ${categoryId}`,
            "ResourceElementCategory",
            categoryId,
            expectedCategoryName,
            client.listCategories.bind(client),
          );
          if (categoryNameGuard) return categoryNameGuard;
        }

        await client.importResource(categoryId, fileName);
        return {
          content: [
            {
              type: "text",
              text: appendGuardGuidance(
                `Resource element imported successfully from: ${fileName}`,
              ),
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
    },
  );

  server.registerTool(
    "update-resource-element",
    {
      title: "Update Resource Element Content",
      description:
        "Update an existing resource element's binary content from a file under the configured resource artifact directory.",
      inputSchema: z.object({
        id: z.string().describe("The resource element ID to update"),
        expectedName: z
          .string()
          .optional()
          .describe(
            "Optional expected resource element name verified before update",
          ),
        expectedCategoryName: z
          .string()
          .optional()
          .describe(
            "Optional expected resource category name verified before update",
          ),
        fileName: z
          .string()
          .describe(
            "File name under the configured resource artifact directory containing the replacement content",
          ),
        changesetSha: z
          .string()
          .optional()
          .describe(
            "Optional X-VRO-Changeset-Sha value for version-controlled content",
          ),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm update. If false, the update will not proceed.",
          ),
      }),
      annotations: DESTRUCTIVE_LIVE_WRITE,
    },
    async ({
      id,
      expectedName,
      expectedCategoryName,
      fileName,
      changesetSha,
      confirm,
    }): Promise<CallToolResult> => {
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
        if (hasAnyExpectedValue({ expectedName, expectedCategoryName })) {
          const resource = await client.getResourceElement(id);
          const guard = guardResourceTarget(
            id,
            resource,
            expectedName,
            expectedCategoryName,
          );
          if (guard) return guard;
        }

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
    },
  );

  server.registerTool(
    "delete-resource-element",
    {
      title: "Delete Resource Element",
      description:
        "Delete a resource element from VCF Automation Orchestrator. Set force to true to delete a resource that is referenced by workflows. Set confirm to true to proceed.",
      inputSchema: z.object({
        id: z.string().describe("The resource element ID to delete"),
        expectedName: z
          .string()
          .optional()
          .describe(
            "Optional expected resource element name verified before deletion",
          ),
        expectedCategoryName: z
          .string()
          .optional()
          .describe(
            "Optional expected resource category name verified before deletion",
          ),
        force: z
          .boolean()
          .optional()
          .describe(
            "Delete even if the resource is referenced by workflows (default: false)",
          ),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm deletion. If false, the deletion will not proceed.",
          ),
      }),
      annotations: DESTRUCTIVE_LIVE_WRITE,
    },
    async ({
      id,
      expectedName,
      expectedCategoryName,
      force,
      confirm,
    }): Promise<CallToolResult> => {
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
        if (hasAnyExpectedValue({ expectedName, expectedCategoryName })) {
          const resource = await client.getResourceElement(id);
          const guard = guardResourceTarget(
            id,
            resource,
            expectedName,
            expectedCategoryName,
          );
          if (guard) return guard;
        }

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
    },
  );
}
