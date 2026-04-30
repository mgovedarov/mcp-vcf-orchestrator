import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { VroClient } from "../vro-client.js";

export function registerPackageTools(
  server: McpServer,
  client: VroClient,
): void {
  server.registerTool(
    "list-packages",
    {
      title: "List vRO Packages",
      description:
        "List vRO packages available on the Orchestrator instance. Optionally filter by name substring.",
      inputSchema: z.object({
        filter: z
          .string()
          .optional()
          .describe("Filter packages by name (substring match)"),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ filter }): Promise<CallToolResult> => {
      try {
        const result = await client.listPackages(filter);
        const packages = result.link ?? [];
        if (packages.length === 0) {
          return {
            content: [{ type: "text", text: "No packages found." }],
          };
        }
        const lines = packages.map(
          (p) =>
            `• ${p.name}${p.version ? ` v${p.version}` : ""}${p.description ? ` — ${p.description}` : ""}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Found ${packages.length} package(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list packages: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get-package",
    {
      title: "Get vRO Package",
      description:
        "Get details of a specific vRO package by its name (e.g. com.example.mypackage).",
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            "The fully-qualified package name (e.g. com.example.mypackage)",
          ),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ name }): Promise<CallToolResult> => {
      try {
        const pkg = await client.getPackage(name);
        let text = `Package: ${pkg.name}\n`;
        if (pkg.version) text += `Version: ${pkg.version}\n`;
        if (pkg.description) text += `Description: ${pkg.description}\n`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get package: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "export-package",
    {
      title: "Export vRO Package",
      description:
        "Export a vRO package as a ZIP file under VCFA_PACKAGE_DIR on the server. " +
        "The package name should be fully qualified (e.g. com.example.mypackage). " +
        "The fileName must be a plain .package or .zip file name, not a path.",
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            "The fully-qualified package name to export (e.g. com.example.mypackage)",
          ),
        fileName: z
          .string()
          .describe(
            "Package file name to save under VCFA_PACKAGE_DIR (e.g. com.example.mypackage.package)",
          ),
        overwrite: z
          .boolean()
          .optional()
          .describe("Overwrite the file if it already exists (default: false)"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ name, fileName, overwrite }): Promise<CallToolResult> => {
      try {
        const savedPath = await client.exportPackage(
          name,
          fileName,
          overwrite ?? false,
        );
        return {
          content: [
            {
              type: "text",
              text: `Package '${name}' exported successfully to: ${savedPath}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to export package: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "import-package",
    {
      title: "Import vRO Package",
      description:
        "Import a vRO package from VCFA_PACKAGE_DIR into the Orchestrator instance. " +
        "The fileName must be a plain .package or .zip file name. " +
        "Set confirm to true to proceed.",
      inputSchema: z.object({
        fileName: z
          .string()
          .describe(
            "Package file name under VCFA_PACKAGE_DIR to import (e.g. com.example.mypackage.package)",
          ),
        overwrite: z
          .boolean()
          .optional()
          .describe(
            "Whether to overwrite existing package contents (default: true)",
          ),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm import. If false, the import will not proceed.",
          ),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ fileName, overwrite, confirm }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm import of package file ${fileName} from ${client.getPackageDirectory()} by setting confirm to true.`,
            },
          ],
        };
      }
      try {
        await client.importPackage(fileName, overwrite ?? true);
        return {
          content: [
            {
              type: "text",
              text: `Package imported successfully from: ${fileName}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to import package: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "delete-package",
    {
      title: "Delete vRO Package",
      description:
        "Delete a vRO package by its fully-qualified name. " +
        "Set deleteContents to true to also delete all workflows, actions, and configurations inside the package.",
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            "The fully-qualified package name to delete (e.g. com.example.mypackage)",
          ),
        deleteContents: z
          .boolean()
          .optional()
          .describe(
            "Also delete all elements (workflows, actions, configs) inside the package (default: false)",
          ),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm deletion. If false, the deletion will not proceed.",
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ name, deleteContents, confirm }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm deletion of package '${name}' by setting confirm to true. This action is irreversible${deleteContents ? " and will delete package contents" : ""}.`,
            },
          ],
        };
      }
      try {
        await client.deletePackage(name, deleteContents ?? false);
        return {
          content: [
            {
              type: "text",
              text: `Package '${name}' deleted successfully${deleteContents ? " (including contents)" : ""}.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to delete package: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
