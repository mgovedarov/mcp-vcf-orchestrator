#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerActionTools } from "./tools/action-tools.js";
import { registerCatalogTools } from "./tools/catalog-tools.js";
import { registerCategoryTools } from "./tools/category-tools.js";
import { registerConfigTools } from "./tools/config-tools.js";
import { registerContextTools } from "./tools/context-tools.js";
import { registerDeploymentTools } from "./tools/deployment-tools.js";
import { registerPackageTools } from "./tools/package-tools.js";
import { registerPluginTools } from "./tools/plugin-tools.js";
import { registerPromotionTools } from "./tools/promotion-tools.js";
import { registerVcfaPrompts } from "./prompts/index.js";
import { registerVcfaResources } from "./resources/index.js";
import { registerResourceTools } from "./tools/resource-tools.js";
import { registerSubscriptionTools } from "./tools/subscription-tools.js";
import { registerTemplateTools } from "./tools/template-tools.js";
import { registerWorkflowTools } from "./tools/workflow-tools.js";
import { normalizeTargetPlatform as parseTargetPlatform } from "./client/core.js";
import { VroClient } from "./vro-client.js";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { version: SERVER_VERSION } = require("../package.json") as {
  version: string;
};

const DEFAULT_ARTIFACT_DIR = join(process.cwd(), "artifacts");
const TARGET_PLATFORM_ENV = "VCFA_TARGET_PLATFORM";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: Required environment variable ${name} is not set.`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  // Read configuration from environment variables
  const host = getRequiredEnv("VCFA_HOST");
  const username = getRequiredEnv("VCFA_USERNAME");
  const organization = getRequiredEnv("VCFA_ORGANIZATION");
  const password = getRequiredEnv("VCFA_PASSWORD");
  const targetPlatform = normalizeTargetPlatform(process.env[TARGET_PLATFORM_ENV]);
  const ignoreTls = process.env["VCFA_IGNORE_TLS"] === "true";
  const artifactDir = process.env["VCFA_ARTIFACT_DIR"] ?? DEFAULT_ARTIFACT_DIR;
  const packageDir = process.env["VCFA_PACKAGE_DIR"];
  const projectPackageName = process.env["VCFA_PROJECT_PACKAGE_NAME"];
  const projectPackageDescription =
    process.env["VCFA_PROJECT_PACKAGE_DESCRIPTION"];
  const resourceDir = process.env["VCFA_RESOURCE_DIR"];
  const workflowDir = process.env["VCFA_WORKFLOW_DIR"];
  const executionLogDir = process.env["VCFA_EXECUTION_LOG_DIR"];
  const actionDir = process.env["VCFA_ACTION_DIR"];
  const configurationDir = process.env["VCFA_CONFIGURATION_DIR"];
  const contextDir = process.env["VCFA_CONTEXT_DIR"];

  if (ignoreTls) {
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
    console.error(
      "[vcfa-server] WARNING: TLS certificate verification disabled (VCFA_IGNORE_TLS=true)",
    );
  }

  // Create vRO API client
  const client = new VroClient({
    host,
    username,
    organization,
    password,
    targetPlatform,
    ignoreTls,
    artifactDir,
    packageDir,
    projectPackageName,
    projectPackageDescription,
    resourceDir,
    workflowDir,
    executionLogDir,
    actionDir,
    configurationDir,
    contextDir,
  });

  // Create MCP server
  const server = new McpServer(
    { name: "vcfa-server", version: SERVER_VERSION },
    {
      instructions: [
        "This server connects to a VCF Automation instance by default, or to vRA/vRO 8.12+ when VCFA_TARGET_PLATFORM is set to vra8.",
        "Use list-categories before creating workflows, actions, or configuration elements to find the target category ID; pass confirm set to true only after the live target and impact are confirmed.",
        "For live mutations, prefer a two-phase confirmation flow: discover the target, pass expectedName or the relevant expected target fields, then set confirm to true so the handler can verify live metadata before mutating.",
        "Use get-workflow to inspect a workflow's input parameters before running it with run-workflow and confirm set to true; pass expectedWorkflowName and expectedInputNames when binding execution to a discovered contract.",
        "Use run-workflow-and-wait with confirm set to true for rapid development loops that validate workflow inputs, wait for completion, and return outputs or diagnostics.",
        "After starting a workflow execution with run-workflow, use get-workflow-execution to poll for completion and retrieve outputs; use get-workflow-execution-logs to retrieve execution logs.",
        "Use export-workflow-file to save a workflow artifact under the configured workflow artifact directory; use direct import-workflow-file only for narrow validation or explicitly requested single-artifact tests.",
        "Use scaffold-workflow-file to generate a local .workflow artifact from structured workflow metadata and linear scriptable tasks before publishing or validating it.",
        "When a workflow step only invokes one existing vRO action, prefer a native action workflow item instead of a scriptable task that calls System.getModule. Use scriptable tasks for multiple action calls or additional orchestration logic. Prefer horizontal left-to-right workflow layouts when authoring or editing XML/package content.",
        "Use preflight-workflow-file, preflight-action-file, preflight-configuration-file, and preflight-package to validate local artifacts before importing them.",
        "Use prepare-artifact-promotion before artifact imports when you need preflight, optional live backup export, workflow/action diff summaries, and the exact confirmed import call; it never imports. Direct imports should include expectedCategoryId, expectedCategoryName, or expectedPackageName when available.",
        "Use collect-context-snapshot to persist reusable Markdown and JSON summaries of workflows, actions, configurations, resources, categories, and optional VCFA domains for future agents.",
        "Use export-action-file to save an action artifact under the configured action artifact directory; use direct import-action-file only for narrow validation or explicitly requested single-artifact tests.",
        "Use export-configuration-file to save a configuration artifact under the configured configuration artifact directory; use import-configuration-file to upload a .vsoconf artifact from that directory into a configuration category.",
        "Use list-event-topics to discover available event topics before creating extensibility subscriptions.",
        "Use list-subscriptions to see existing event-driven triggers.",
        "Use list-catalog-items to browse the Service Broker catalog; use get-catalog-item to inspect a specific item by ID.",
        "Use list-deployments to see existing deployments; use create-deployment with confirm set to true to deploy a catalog item, providing the catalogItemId, deploymentName, and projectId. Use list-deployment-actions to discover available deployment day-2 actions, then run-deployment-action with confirm set to true and expectedDeploymentName and expectedActionName to submit one.",
        "Use list-templates to browse blueprint templates; use get-template to inspect a specific template by ID; use create-template with confirm set to true to create a new template; use delete-template with expectedName or project/status expected fields to remove one.",
        "Publish reusable vRO content through packages by default: use ensure-project-package, add content to the exact project package, rebuild-project-package, export-project-package, get-project-package-import-details, then import-project-package. Reuse the configured project package from VCFA_PROJECT_PACKAGE_NAME; never create one-off packages unless the user confirms the exact package name.",
        "Use list-resource-elements to browse vRO resource elements; use list-categories with type ResourceElementCategory before importing a resource element; exported and imported resource files are stored under the configured resource artifact directory.",
        "Use list-plugins to see all installed vRO plugins.",
      ].join(" "),
    },
  );

  // Register all tools
  registerWorkflowTools(server, client);
  registerActionTools(server, client);
  registerConfigTools(server, client);
  registerCategoryTools(server, client);
  registerSubscriptionTools(server, client);
  registerCatalogTools(server, client);
  registerDeploymentTools(server, client);
  registerTemplateTools(server, client);
  registerPackageTools(server, client);
  registerPromotionTools(server, client);
  registerContextTools(server, client);
  registerResourceTools(server, client);
  registerPluginTools(server, client);
  registerVcfaResources(server, client);
  registerVcfaPrompts(server);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[vcfa-server] MCP server started (stdio transport)");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.error("[vcfa-server] Shutting down...");
    await server.close();
    process.exit(0);
  });
}

function normalizeTargetPlatform(value: string | undefined): "vcfa" | "vra8" {
  try {
    return parseTargetPlatform(value);
  } catch {
    console.error(
      `ERROR: ${TARGET_PLATFORM_ENV} must be one of: vcfa, vra8.`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[vcfa-server] Fatal error:", error);
  process.exit(1);
});
