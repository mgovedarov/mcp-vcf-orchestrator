#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerActionTools } from "./tools/action-tools.js";
import { registerCatalogTools } from "./tools/catalog-tools.js";
import { registerCategoryTools } from "./tools/category-tools.js";
import { registerConfigTools } from "./tools/config-tools.js";
import { registerDeploymentTools } from "./tools/deployment-tools.js";
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

  if (ignoreTls) {
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
    console.error(
      "[vcfa-server] WARNING: TLS certificate verification disabled (VCFA_IGNORE_TLS=true)"
    );
  }

  // Create vRO API client
  const client = new VroClient({ host, username, organization, password, ignoreTls });

  // Create MCP server
  const server = new McpServer(
    { name: "vcfa-server", version: "1.0.0" },
    {
      instructions: [
        "This server connects to a VCF Automation instance.",
        "Use list-categories before creating workflows, actions, or configuration elements to find the target category ID.",
        "Use get-workflow to inspect a workflow's input parameters before running it with run-workflow.",
        "After starting a workflow execution with run-workflow, use get-workflow-execution to poll for completion and retrieve outputs.",
        "Use list-event-topics to discover available event topics before creating extensibility subscriptions.",
        "Use list-subscriptions to see existing event-driven triggers.",
        "Use list-catalog-items to browse the Service Broker catalog; use get-catalog-item to inspect a specific item by ID.",
        "Use list-deployments to see existing deployments; use create-deployment to deploy a catalog item, providing the catalogItemId, deploymentName, and projectId.",
        "Use list-templates to browse blueprint templates; use get-template to inspect a specific template by ID; use create-template to create a new template; use delete-template to remove one.",
      ].join(" "),
    }
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
