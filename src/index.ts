#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerActionTools } from "./tools/action-tools.js";
import { registerCatalogTools } from "./tools/catalog-tools.js";
import { registerCategoryTools } from "./tools/category-tools.js";
import { registerConfigTools } from "./tools/config-tools.js";
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
import { VroClient } from "./vro-client.js";

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
  const ignoreTls = process.env["VCFA_IGNORE_TLS"] === "true";
  const artifactDir = process.env["VCFA_ARTIFACT_DIR"];
  const packageDir = process.env["VCFA_PACKAGE_DIR"];
  const resourceDir = process.env["VCFA_RESOURCE_DIR"];
  const workflowDir = process.env["VCFA_WORKFLOW_DIR"];
  const actionDir = process.env["VCFA_ACTION_DIR"];
  const configurationDir = process.env["VCFA_CONFIGURATION_DIR"];

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
    ignoreTls,
    artifactDir,
    packageDir,
    resourceDir,
    workflowDir,
    actionDir,
    configurationDir,
  });

  // Create MCP server
  const server = new McpServer(
    { name: "vcfa-server", version: "1.0.0" },
    {
      instructions: [
        "This server connects to a VCF Automation instance.",
        "Use list-categories before creating workflows, actions, or configuration elements to find the target category ID.",
        "Use get-workflow to inspect a workflow's input parameters before running it with run-workflow.",
        "Use run-workflow-and-wait for rapid development loops that validate workflow inputs, wait for completion, and return outputs or diagnostics.",
        "After starting a workflow execution with run-workflow, use get-workflow-execution to poll for completion and retrieve outputs.",
        "Use export-workflow-file to save a workflow artifact under the configured workflow artifact directory; use import-workflow-file to upload a .workflow artifact from that directory into a workflow category.",
        "Use scaffold-workflow-file to generate a local .workflow artifact from structured workflow metadata and linear scriptable tasks before importing it.",
        "Use preflight-workflow-file, preflight-action-file, preflight-configuration-file, and preflight-package to validate local artifacts before importing them.",
        "Use prepare-artifact-promotion before artifact imports when you need preflight, optional live backup export, workflow/action diff summaries, and the exact confirmed import call; it never imports.",
        "Use export-action-file to save an action artifact under the configured action artifact directory; use import-action-file to upload a .action artifact from that directory into an action category by category name.",
        "Use export-configuration-file to save a configuration artifact under the configured configuration artifact directory; use import-configuration-file to upload a .vsoconf artifact from that directory into a configuration category.",
        "Use list-event-topics to discover available event topics before creating extensibility subscriptions.",
        "Use list-subscriptions to see existing event-driven triggers.",
        "Use list-catalog-items to browse the Service Broker catalog; use get-catalog-item to inspect a specific item by ID.",
        "Use list-deployments to see existing deployments; use create-deployment to deploy a catalog item, providing the catalogItemId, deploymentName, and projectId. Use list-deployment-actions to discover available deployment day-2 actions, then run-deployment-action with confirm set to true to submit one.",
        "Use list-templates to browse blueprint templates; use get-template to inspect a specific template by ID; use create-template to create a new template; use delete-template to remove one.",
        "Use list-packages to browse vRO packages; use export-package to save a package file under the configured package artifact directory; use import-package to upload a package file from that directory; use delete-package with confirm set to true to remove a package.",
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

main().catch((error) => {
  console.error("[vcfa-server] Fatal error:", error);
  process.exit(1);
});
