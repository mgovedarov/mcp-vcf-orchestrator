import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { formatPreflightReport } from "../client/artifact-preflight.js";
import type { VroClient } from "../vro-client.js";
import { DESTRUCTIVE_LIVE_WRITE } from "./annotations.js";
import {
  appendGuardGuidance,
  guardExpectedFields,
  hasAnyExpectedValue,
} from "./confirmation-guards.js";

const packageExportOptionsSchema = {
  exportConfigurationAttributeValues: z.boolean().optional(),
  exportGlobalTags: z.boolean().optional(),
  exportVersionHistory: z.boolean().optional(),
  exportConfigSecureStringAttributeValues: z.boolean().optional(),
};

const packageImportOptionsSchema = {
  importConfigurationAttributeValues: z.boolean().optional(),
  tagImportMode: z
    .enum([
      "DoNotImport",
      "ImportAndOverwriteExistingValue",
      "ImportButPreserveExistingValue",
    ])
    .optional(),
  importConfigSecureStringAttributeValues: z.boolean().optional(),
};

function packageFileName(packageName: string): string {
  return `${packageName}.package`;
}

function formatProjectPackage(result: {
  name: string;
  created: boolean;
  package?: { description?: string };
}): string {
  return [
    `Project package: ${result.name}`,
    `Status: ${result.created ? "created" : "reused"}`,
    result.package?.description
      ? `Description: ${result.package.description}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatImportDetails(details: {
  packageName?: string;
  packageAlreadyExists?: boolean;
  contentVerified?: boolean;
  certificateValid?: boolean;
  certificateTrusted?: boolean;
  certificateUnknown?: boolean;
  importElementDetails?: unknown[];
}): string {
  return [
    `Package import details: ${details.packageName ?? "(unknown)"}`,
    `Already exists: ${String(details.packageAlreadyExists ?? false)}`,
    `Content verified: ${String(details.contentVerified ?? false)}`,
    `Certificate valid: ${String(details.certificateValid ?? false)}`,
    `Certificate trusted: ${String(details.certificateTrusted ?? false)}`,
    `Certificate unknown: ${String(details.certificateUnknown ?? false)}`,
    `Elements: ${details.importElementDetails?.length ?? 0}`,
  ].join("\n");
}

function assertProjectPackageImportMatches(
  details: { packageName?: string },
  expectedPackageName: string,
): void {
  if (details.packageName && details.packageName !== expectedPackageName) {
    throw new Error(
      `Package file contains '${details.packageName}', but project package '${expectedPackageName}' was requested.`,
    );
  }
}

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
    },
  );

  server.registerTool(
    "export-package",
    {
      title: "Export vRO Package",
      description:
        "Export a vRO package as a ZIP file under the configured package artifact directory on the server. " +
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
            "Package file name to save under the configured package artifact directory (e.g. com.example.mypackage.package)",
          ),
        overwrite: z
          .boolean()
          .optional()
          .describe("Overwrite the file if it already exists (default: false)"),
        ...packageExportOptionsSchema,
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      name,
      fileName,
      overwrite,
      exportConfigurationAttributeValues,
      exportGlobalTags,
      exportVersionHistory,
      exportConfigSecureStringAttributeValues,
    }): Promise<CallToolResult> => {
      try {
        const savedPath = await client.exportPackage(
          name,
          fileName,
          overwrite ?? false,
          {
            exportConfigurationAttributeValues,
            exportGlobalTags,
            exportVersionHistory,
            exportConfigSecureStringAttributeValues,
          },
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
    "preflight-package",
    {
      title: "Preflight vRO Package",
      description:
        "Validate a local .package or .zip artifact under the configured package artifact directory before importing it.",
      inputSchema: z.object({
        fileName: z
          .string()
          .describe("Package file name under the configured package artifact directory to validate"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ fileName }): Promise<CallToolResult> => {
      try {
        const report = await client.preflightPackageFile(fileName);
        return {
          content: [{ type: "text", text: formatPreflightReport(report) }],
          isError: !report.valid,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to preflight package: ${error instanceof Error ? error.message : String(error)}`,
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
        "Import a vRO package from the configured package artifact directory into the Orchestrator instance. " +
        "The fileName must be a plain .package or .zip file name. " +
        "Set confirm to true to proceed.",
      inputSchema: z.object({
        fileName: z
          .string()
          .describe(
            "Package file name under the configured package artifact directory to import (e.g. com.example.mypackage.package)",
          ),
        overwrite: z
          .boolean()
          .optional()
          .describe(
            "Whether to overwrite existing package contents (default: true)",
          ),
        expectedPackageName: z
          .string()
          .optional()
          .describe(
            "Optional expected package name verified from package import details before import",
          ),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm import. If false, the import will not proceed.",
          ),
        ...packageImportOptionsSchema,
      }),
      annotations: DESTRUCTIVE_LIVE_WRITE,
    },
    async ({
      fileName,
      overwrite,
      expectedPackageName,
      confirm,
      importConfigurationAttributeValues,
      tagImportMode,
      importConfigSecureStringAttributeValues,
    }): Promise<CallToolResult> => {
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
        if (hasAnyExpectedValue({ expectedPackageName })) {
          const details = await client.getPackageImportDetails(fileName);
          const guard = guardExpectedFields(`package import ${fileName}`, [
            {
              label: "package name",
              expected: expectedPackageName,
              actual: details.packageName,
            },
          ]);
          if (guard) return guard;
        }

        await client.importPackageWithOptions(fileName, {
          overwrite: overwrite ?? true,
          importConfigurationAttributeValues,
          tagImportMode,
          importConfigSecureStringAttributeValues,
        });
        return {
          content: [
            {
              type: "text",
              text: appendGuardGuidance(
                `Package imported successfully from: ${fileName}${overwrite === undefined ? "\nOverwrite defaulted to true; pass overwrite explicitly when possible." : ""}`,
              ),
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
    "get-package-import-details",
    {
      title: "Get Package Import Details",
      description:
        "Analyze a local package file before import and return package elements and certificate details.",
      inputSchema: z.object({
        fileName: z
          .string()
          .describe("Package file name under the configured package artifact directory"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ fileName }): Promise<CallToolResult> => {
      try {
        const details = await client.getPackageImportDetails(fileName);
        return { content: [{ type: "text", text: formatImportDetails(details) }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get package import details: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "create-package",
    {
      title: "Create Project Package",
      description:
        "Create a vRO package by exact fully-qualified name. Refuses to create if the package already exists.",
      inputSchema: z.object({
        name: z.string().describe("Exact fully-qualified package name"),
        description: z.string().optional().describe("Package description"),
        confirm: z
          .boolean()
          .describe("Must be true to create this exact package."),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ name, description, confirm }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm creation of package '${name}' by setting confirm to true.`,
            },
          ],
        };
      }
      try {
        await client.createPackage(name, description);
        return {
          content: [{ type: "text", text: `Package '${name}' created.` }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to create package: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "ensure-project-package",
    {
      title: "Ensure Project Package",
      description:
        "Resolve and reuse the exact configured project package. Creates it only when createIfMissing and confirm are both true.",
      inputSchema: z.object({
        packageName: z
          .string()
          .optional()
          .describe("Exact package name. Defaults to VCFA_PROJECT_PACKAGE_NAME."),
        description: z
          .string()
          .optional()
          .describe("Description to use only if the package is created."),
        createIfMissing: z
          .boolean()
          .optional()
          .describe("Create the exact project package if it is missing."),
        confirm: z
          .boolean()
          .optional()
          .describe("Must be true together with createIfMissing to create."),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      packageName,
      description,
      createIfMissing,
      confirm,
    }): Promise<CallToolResult> => {
      try {
        const result = await client.ensureProjectPackage({
          packageName,
          description,
          createIfMissing,
          confirm,
        });
        return { content: [{ type: "text", text: formatProjectPackage(result) }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to ensure project package: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "rebuild-project-package",
    {
      title: "Rebuild Project Package",
      description:
        "Rebuild the exact project package after adding content. Reuses the configured package name.",
      inputSchema: z.object({
        packageName: z.string().optional().describe("Exact package name"),
        confirm: z.boolean().describe("Must be true to rebuild the package."),
      }),
      annotations: DESTRUCTIVE_LIVE_WRITE,
    },
    async ({ packageName, confirm }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: "Confirm rebuild of the project package by setting confirm to true.",
            },
          ],
        };
      }
      try {
        const result = await client.ensureProjectPackage({ packageName });
        await client.rebuildPackage(result.name);
        return {
          content: [
            { type: "text", text: `Package '${result.name}' rebuilt.` },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to rebuild project package: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "add-workflow-to-project-package",
    {
      title: "Add Workflow To Project Package",
      description:
        "Add a workflow and dependencies to the exact project package. Reuses the configured package.",
      inputSchema: z.object({
        packageName: z.string().optional().describe("Exact package name"),
        workflowId: z.string().describe("Workflow ID to add"),
        confirm: z.boolean().describe("Must be true to add content."),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      packageName,
      workflowId,
      confirm,
    }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm adding workflow ${workflowId} to the project package by setting confirm to true.`,
            },
          ],
        };
      }
      try {
        const result = await client.ensureProjectPackage({ packageName });
        await client.addWorkflowToPackage(result.name, workflowId);
        return {
          content: [
            {
              type: "text",
              text: `Workflow ${workflowId} added to package '${result.name}'.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to add workflow to project package: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "add-action-to-project-package",
    {
      title: "Add Action To Project Package",
      description:
        "Add an action and dependencies to the exact project package. Reuses the configured package.",
      inputSchema: z.object({
        packageName: z.string().optional().describe("Exact package name"),
        categoryName: z.string().describe("Action category/module name"),
        actionName: z.string().describe("Action name"),
        confirm: z.boolean().describe("Must be true to add content."),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      packageName,
      categoryName,
      actionName,
      confirm,
    }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm adding action ${categoryName}/${actionName} to the project package by setting confirm to true.`,
            },
          ],
        };
      }
      try {
        const result = await client.ensureProjectPackage({ packageName });
        await client.addActionToPackage(result.name, categoryName, actionName);
        return {
          content: [
            {
              type: "text",
              text: `Action ${categoryName}/${actionName} added to package '${result.name}'.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to add action to project package: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "add-configuration-to-project-package",
    {
      title: "Add Configuration To Project Package",
      description:
        "Add a configuration element and dependencies to the exact project package.",
      inputSchema: z.object({
        packageName: z.string().optional().describe("Exact package name"),
        configurationId: z.string().describe("Configuration element ID"),
        confirm: z.boolean().describe("Must be true to add content."),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      packageName,
      configurationId,
      confirm,
    }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm adding configuration ${configurationId} to the project package by setting confirm to true.`,
            },
          ],
        };
      }
      try {
        const result = await client.ensureProjectPackage({ packageName });
        await client.addConfigurationToPackage(result.name, configurationId);
        return {
          content: [
            {
              type: "text",
              text: `Configuration ${configurationId} added to package '${result.name}'.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to add configuration to project package: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "add-resource-to-project-package",
    {
      title: "Add Resource To Project Package",
      description:
        "Add a resource element and dependencies to the exact project package.",
      inputSchema: z.object({
        packageName: z.string().optional().describe("Exact package name"),
        resourceId: z.string().describe("Resource element ID"),
        confirm: z.boolean().describe("Must be true to add content."),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      packageName,
      resourceId,
      confirm,
    }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm adding resource ${resourceId} to the project package by setting confirm to true.`,
            },
          ],
        };
      }
      try {
        const result = await client.ensureProjectPackage({ packageName });
        await client.addResourceToPackage(result.name, resourceId);
        return {
          content: [
            {
              type: "text",
              text: `Resource ${resourceId} added to package '${result.name}'.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to add resource to project package: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "export-project-package",
    {
      title: "Export Project Package",
      description:
        "Export the exact project package to the configured package artifact directory.",
      inputSchema: z.object({
        packageName: z.string().optional().describe("Exact package name"),
        fileName: z
          .string()
          .optional()
          .describe("Output .package file name. Defaults to packageName.package."),
        overwrite: z.boolean().optional(),
        ...packageExportOptionsSchema,
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      packageName,
      fileName,
      overwrite,
      exportConfigurationAttributeValues,
      exportGlobalTags,
      exportVersionHistory,
      exportConfigSecureStringAttributeValues,
    }): Promise<CallToolResult> => {
      try {
        const result = await client.ensureProjectPackage({ packageName });
        const savedPath = await client.exportPackage(
          result.name,
          fileName ?? packageFileName(result.name),
          overwrite ?? false,
          {
            exportConfigurationAttributeValues,
            exportGlobalTags,
            exportVersionHistory,
            exportConfigSecureStringAttributeValues,
          },
        );
        return {
          content: [
            {
              type: "text",
              text: `Project package '${result.name}' exported successfully to: ${savedPath}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to export project package: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get-project-package-import-details",
    {
      title: "Get Project Package Import Details",
      description:
        "Analyze an exported project package file before import.",
      inputSchema: z.object({
        packageName: z.string().optional().describe("Exact package name"),
        fileName: z
          .string()
          .optional()
          .describe("Package file name. Defaults to packageName.package."),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ packageName, fileName }): Promise<CallToolResult> => {
      try {
        const resolvedPackageName = client.resolveProjectPackageName(packageName);
        const details = await client.getPackageImportDetails(
          fileName ?? packageFileName(resolvedPackageName),
        );
        return { content: [{ type: "text", text: formatImportDetails(details) }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get project package import details: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "import-project-package",
    {
      title: "Import Project Package",
      description:
        "Import an exported project package file. Reuses the configured project package name for the default file name.",
      inputSchema: z.object({
        packageName: z.string().optional().describe("Exact package name"),
        fileName: z
          .string()
          .optional()
          .describe("Package file name. Defaults to packageName.package."),
        overwrite: z.boolean().optional(),
        expectedPackageName: z
          .string()
          .optional()
          .describe(
            "Optional expected package name verified from package import details before import",
          ),
        confirm: z.boolean().describe("Must be true to import the package."),
        ...packageImportOptionsSchema,
      }),
      annotations: DESTRUCTIVE_LIVE_WRITE,
    },
    async ({
      packageName,
      fileName,
      overwrite,
      expectedPackageName,
      confirm,
      importConfigurationAttributeValues,
      tagImportMode,
      importConfigSecureStringAttributeValues,
    }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: "Confirm import of the project package by setting confirm to true.",
            },
          ],
        };
      }
      try {
        const resolvedPackageName = client.resolveProjectPackageName(packageName);
        const resolvedFileName = fileName ?? packageFileName(resolvedPackageName);
        const details = await client.getPackageImportDetails(resolvedFileName);
        assertProjectPackageImportMatches(details, resolvedPackageName);
        const guard = guardExpectedFields(
          `project package import ${resolvedFileName}`,
          [
            {
              label: "package name",
              expected: expectedPackageName,
              actual: details.packageName,
            },
          ],
        );
        if (guard) return guard;

        await client.importPackageWithOptions(resolvedFileName, {
          overwrite: overwrite ?? true,
          importConfigurationAttributeValues,
          tagImportMode,
          importConfigSecureStringAttributeValues,
        });
        return {
          content: [
            {
              type: "text",
              text: `Project package '${resolvedPackageName}' imported from: ${resolvedFileName}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to import project package: ${error instanceof Error ? error.message : String(error)}`,
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
        expectedName: z
          .string()
          .optional()
          .describe("Optional expected live package name verified before deletion"),
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
      annotations: DESTRUCTIVE_LIVE_WRITE,
    },
    async ({
      name,
      expectedName,
      deleteContents,
      confirm,
    }): Promise<CallToolResult> => {
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
        if (hasAnyExpectedValue({ expectedName })) {
          const pkg = await client.getPackage(name);
          const guard = guardExpectedFields(`package ${name}`, [
            {
              label: "package name",
              expected: expectedName,
              actual: pkg.name,
            },
          ]);
          if (guard) return guard;
        }

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
