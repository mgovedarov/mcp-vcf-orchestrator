import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { formatPreflightReport } from "../client/artifact-preflight.js";
import type { VroClient } from "../vro-client.js";
import { truncationNote } from "./truncation.js";
import { DESTRUCTIVE_LIVE_WRITE } from "./annotations.js";
import {
  appendGuardGuidance,
  guardExpectedCategory,
  guardExpectedFields,
  hasAnyExpectedValue,
} from "./confirmation-guards.js";

/**
 * Detects secure/encrypted configuration attribute types whose values must never
 * be printed (e.g. vRO `SecureString`). The `includes` checks are defensive against
 * any encrypted/secure variant the API returns. Mirrors the redaction posture of the
 * context-snapshot path (`src/client/context-snapshot.ts`).
 */
function isSecureAttributeType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return t === "securestring" || t.includes("secure") || t.includes("encrypted");
}

export function registerConfigTools(
  server: McpServer,
  client: VroClient,
): void {
  server.registerTool(
    "list-configurations",
    {
      title: "List Configuration Elements",
      description:
        "List configuration elements from VCF Automation Orchestrator. Optionally filter by name or scope to a specific category.",
      inputSchema: z.object({
        filter: z
          .string()
          .optional()
          .describe("Filter configuration elements by name (substring match)"),
        categoryId: z
          .string()
          .optional()
          .describe(
            "Filter configuration elements by ConfigurationElementCategory ID. Use list-categories with type ConfigurationElementCategory to find a category ID.",
          ),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ filter, categoryId }): Promise<CallToolResult> => {
      try {
        const result = await client.listConfigurations(filter, categoryId);
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
            `• ${c.name} (id: ${c.id})${c.description ? ` — ${c.description}` : ""}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Found ${configs.length} configuration element(s):\n\n${lines.join("\n")}${truncationNote(result, configs.length, result.total)}`,
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
    },
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
        if (config.description) text += `Description: ${config.description}\n`;
        if (config.version) text += `Version: ${config.version}\n`;

        const attrs = config.attributes ?? [];
        if (attrs.length > 0) {
          text += `\nAttributes:\n`;
          for (const a of attrs) {
            const val = isSecureAttributeType(a.type)
              ? "[redacted]"
              : a.value
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
    },
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
          .describe("The category ID to create the configuration element in"),
        name: z.string().describe("Name for the new configuration element"),
        description: z.string().optional().describe("Optional description"),
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
            }),
          )
          .optional()
          .describe("Initial attributes for the configuration element"),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm configuration element creation. If false, the element will not be created.",
          ),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      categoryId,
      name,
      description,
      attributes,
      confirm,
    }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm creation of configuration element ${name} in category ${categoryId} by setting confirm to true.`,
            },
          ],
        };
      }

      try {
        const config = await client.createConfiguration(
          categoryId,
          name,
          description,
          attributes,
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
    },
  );

  server.registerTool(
    "delete-configuration",
    {
      title: "Delete Configuration Element",
      description:
        "Delete a configuration element from VCF Automation Orchestrator. This action is irreversible. Set confirm to true to proceed.",
      inputSchema: z.object({
        id: z.string().describe("The configuration element ID to delete"),
        expectedName: z
          .string()
          .optional()
          .describe(
            "Optional expected configuration element name verified before deletion",
          ),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm deletion. If false, the deletion will not proceed.",
          ),
      }),
      annotations: DESTRUCTIVE_LIVE_WRITE,
    },
    async ({ id, expectedName, confirm }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm deletion of configuration element ${id} by setting confirm to true. This action is irreversible.`,
            },
          ],
        };
      }
      try {
        if (hasAnyExpectedValue({ expectedName })) {
          const config = await client.getConfiguration(id);
          const guard = guardExpectedFields(`configuration ${id}`, [
            {
              label: "configuration name",
              expected: expectedName,
              actual: config.name,
            },
          ]);
          if (guard) return guard;
        }

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
    },
  );

  server.registerTool(
    "export-configuration-file",
    {
      title: "Export Configuration File",
      description:
        "Export a vRO configuration element as a .vsoconf file under the configured configuration artifact directory. The fileName must be a plain .vsoconf file name, not a path.",
      inputSchema: z.object({
        id: z.string().describe("The configuration element ID to export"),
        fileName: z
          .string()
          .describe(
            "Configuration file name to save under the configured configuration artifact directory",
          ),
        overwrite: z
          .boolean()
          .optional()
          .describe("Overwrite the file if it already exists (default: false)"),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ id, fileName, overwrite }): Promise<CallToolResult> => {
      try {
        const savedPath = await client.exportConfigurationFile(
          id,
          fileName,
          overwrite ?? false,
        );
        return {
          content: [
            {
              type: "text",
              text: `Configuration element ${id} exported successfully to: ${savedPath}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to export configuration file: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "preflight-configuration-file",
    {
      title: "Preflight Configuration File",
      description:
        "Validate a local .vsoconf artifact under the configured configuration artifact directory before importing it.",
      inputSchema: z.object({
        fileName: z
          .string()
          .describe(
            "Configuration file name under the configured configuration artifact directory to validate",
          ),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ fileName }): Promise<CallToolResult> => {
      try {
        const report = await client.preflightConfigurationFile(fileName);
        return {
          content: [{ type: "text", text: formatPreflightReport(report) }],
          isError: !report.valid,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to preflight configuration file: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "import-configuration-file",
    {
      title: "Import Configuration File",
      description:
        "Import a .vsoconf file from the configured configuration artifact directory into a configuration element category. Use list-categories with type ConfigurationElementCategory to find a category ID first. Set confirm to true to proceed.",
      inputSchema: z.object({
        categoryId: z
          .string()
          .describe("The configuration element category ID to import into"),
        fileName: z
          .string()
          .describe(
            "Configuration file name under the configured configuration artifact directory to import",
          ),
        expectedCategoryId: z
          .string()
          .optional()
          .describe(
            "Optional expected configuration category ID; must match categoryId before import",
          ),
        expectedCategoryName: z
          .string()
          .optional()
          .describe(
            "Optional expected configuration category name verified before import",
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
              text: `Confirm import of configuration file ${fileName} from ${client.getConfigurationDirectory()} by setting confirm to true.`,
            },
          ],
        };
      }
      try {
        const categoryIdGuard = guardExpectedFields(
          `configuration import target ${categoryId}`,
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
            `configuration import target ${categoryId}`,
            "ConfigurationElementCategory",
            categoryId,
            expectedCategoryName,
            client.listCategories.bind(client),
          );
          if (categoryNameGuard) return categoryNameGuard;
        }

        await client.importConfigurationFile(categoryId, fileName);
        return {
          content: [
            {
              type: "text",
              text: appendGuardGuidance(
                `Configuration element imported successfully from: ${fileName}`,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to import configuration file: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "update-configuration",
    {
      title: "Update Configuration Element",
      description:
        "Update an existing configuration element's name, description, or attributes. Only the fields you provide will be updated.",
      inputSchema: z.object({
        id: z.string().describe("The configuration element ID to update"),
        expectedName: z
          .string()
          .optional()
          .describe(
            "Optional expected current configuration element name verified before update",
          ),
        name: z
          .string()
          .optional()
          .describe("New name for the configuration element"),
        description: z.string().optional().describe("New description"),
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
                .describe("Attribute value as a string"),
            }),
          )
          .optional()
          .describe("New attributes (replaces existing ones)"),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm configuration element update. If false, the element will not be updated.",
          ),
      }),
      annotations: DESTRUCTIVE_LIVE_WRITE,
    },
    async ({
      id,
      expectedName,
      name,
      description,
      attributes,
      confirm,
    }): Promise<CallToolResult> => {
      if (
        name === undefined &&
        description === undefined &&
        attributes === undefined
      ) {
        return {
          content: [
            {
              type: "text",
              text: `Nothing to update for configuration element ${id}. Provide at least one of name, description, or attributes.`,
            },
          ],
          isError: true,
        };
      }
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm update of configuration element ${id} by setting confirm to true.`,
            },
          ],
        };
      }

      try {
        if (hasAnyExpectedValue({ expectedName })) {
          const config = await client.getConfiguration(id);
          const guard = guardExpectedFields(`configuration ${id}`, [
            {
              label: "configuration name",
              expected: expectedName,
              actual: config.name,
            },
          ]);
          if (guard) return guard;
        }

        await client.updateConfiguration(id, { name, description, attributes });
        return {
          content: [
            {
              type: "text",
              text: `Configuration element ${id} updated successfully.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to update configuration: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
