import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { VroClient } from "../vro-client.js";

export function registerPackageTools(
  server: McpServer,
  client: VroClient
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
      annotations: { readOnlyHint: true },
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
            `• ${p.name}${p.version ? ` v${p.version}` : ""}${p.description ? ` — ${p.description}` : ""}`
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
    }
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
          .describe("The fully-qualified package name (e.g. com.example.mypackage)"),
      }),
      annotations: { readOnlyHint: true },
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
    }
  );

  server.registerTool(
    "export-package",
    {
      title: "Export vRO Package",
      description:
        "Export a vRO package as a ZIP file to a local path on the server. " +
        "The package name should be fully qualified (e.g. com.example.mypackage). " +
        "The destination path must be an absolute file path (e.g. /tmp/com.example.mypackage.package).",
      inputSchema: z.object({
        name: z
          .string()
          .describe("The fully-qualified package name to export (e.g. com.example.mypackage)"),
        destPath: z
          .string()
          .describe("Absolute local file path where the ZIP will be saved (e.g. /tmp/com.example.mypackage.package)"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ name, destPath }): Promise<CallToolResult> => {
      try {
        await client.exportPackage(name, destPath);
        return {
          content: [
            {
              type: "text",
              text: `Package '${name}' exported successfully to: ${destPath}`,
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
    }
  );

  server.registerTool(
    "import-package",
    {
      title: "Import vRO Package",
      description:
        "Import a vRO package from a local ZIP file into the Orchestrator instance. " +
        "The source path must be an absolute file path to a .package ZIP file. " +
        "Set overwrite to true (default) to overwrite existing package contents.",
      inputSchema: z.object({
        srcPath: z
          .string()
          .describe("Absolute local file path of the .package ZIP to import (e.g. /tmp/com.example.mypackage.package)"),
        overwrite: z
          .boolean()
          .optional()
          .describe("Whether to overwrite existing package contents (default: true)"),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ srcPath, overwrite }): Promise<CallToolResult> => {
      try {
        await client.importPackage(srcPath, overwrite ?? true);
        return {
          content: [
            {
              type: "text",
              text: `Package imported successfully from: ${srcPath}`,
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
    }
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
          .describe("The fully-qualified package name to delete (e.g. com.example.mypackage)"),
        deleteContents: z
          .boolean()
          .optional()
          .describe("Also delete all elements (workflows, actions, configs) inside the package (default: false)"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ name, deleteContents }): Promise<CallToolResult> => {
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
    }
  );
}
