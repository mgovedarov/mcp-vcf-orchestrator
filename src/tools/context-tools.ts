import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { VroClient } from "../vro-client.js";

const contextDomainSchema = z.enum([
  "workflows",
  "actions",
  "configurations",
  "resources",
  "categories",
  "templates",
  "catalogItems",
  "eventTopics",
  "subscriptions",
  "packages",
  "plugins",
]);

export function registerContextTools(
  server: McpServer,
  client: VroClient,
): void {
  server.registerTool(
    "collect-context-snapshot",
    {
      title: "Collect Context Snapshot",
      description:
        "Collect reusable VCF Automation/vRO environment context and persist deterministic Markdown and JSON snapshots for future agents. Secrets, scripts, template YAML, and binary content are omitted by default.",
      inputSchema: z.object({
        fileBaseName: z
          .string()
          .optional()
          .describe(
            "Base file name for the generated .json and .md files under the configured context directory. Defaults to vcfa-context.",
          ),
        overwrite: z
          .boolean()
          .optional()
          .describe("Overwrite existing snapshot files. Defaults to false."),
        domains: z
          .array(contextDomainSchema)
          .optional()
          .describe(
            "Domains to collect. Defaults to workflows, actions, configurations, resources, and categories.",
          ),
        includeOptionalDomains: z
          .boolean()
          .optional()
          .describe(
            "Also collect templates, catalog items, event topics, subscriptions, packages, and plugins.",
          ),
        maxItemsPerDomain: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum items to collect per domain. Defaults to 100."),
        profile: z
          .enum(["default", "vcfaBuiltIns"])
          .optional()
          .describe(
            "Snapshot profile. Use vcfaBuiltIns to collect workflows in subfolders below Library and actions in com.vmware modules.",
          ),
      }),
      annotations: { readOnlyHint: true },
    },
    async (params): Promise<CallToolResult> => {
      try {
        const result = await client.collectContextSnapshot(params);
        const warnings =
          result.warnings.length > 0
            ? `\nWarnings:\n${result.warnings.map((warning) => `  • ${warning}`).join("\n")}`
            : "";
        return {
          content: [
            {
              type: "text",
              text: [
                "Context snapshot collected.",
                `JSON: ${result.jsonPath}`,
                `Markdown: ${result.markdownPath}`,
                `Counts: ${JSON.stringify(result.counts)}`,
                `Skipped: ${JSON.stringify(result.skipped)}`,
                warnings,
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to collect context snapshot: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
