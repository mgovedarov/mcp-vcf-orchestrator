import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { VroClient } from "../vro-client.js";

const promotionTargetSchema = z
  .object({
    categoryId: z.string().optional(),
    categoryName: z.string().optional(),
    workflowId: z.string().optional(),
    actionId: z.string().optional(),
    configurationId: z.string().optional(),
    packageName: z.string().optional(),
  })
  .optional();

const promotionBackupSchema = z
  .object({
    enabled: z.boolean(),
    fileName: z.string().optional(),
    overwrite: z.boolean().optional(),
  })
  .optional();

export function registerPromotionTools(
  server: McpServer,
  client: VroClient,
): void {
  server.registerTool(
    "prepare-artifact-promotion",
    {
      title: "Prepare Artifact Promotion",
      description:
        "Run preflight for a local workflow, action, configuration, or package artifact; optionally export a live backup; summarize risks and changes; and recommend the exact import tool call. This tool never imports.",
      inputSchema: z.object({
        kind: z
          .enum(["workflow", "action", "configuration", "package"])
          .describe("Artifact kind to prepare"),
        fileName: z
          .string()
          .describe("Plain artifact file name under the configured artifact directory for the selected kind"),
        target: promotionTargetSchema.describe(
          "Optional live target and import category details",
        ),
        overwrite: z
          .boolean()
          .optional()
          .describe("Overwrite flag to include in the recommended import call where supported (default: true)"),
        backup: promotionBackupSchema.describe(
          "Optional live backup export settings. When enabled, the matching live target ID/name is required.",
        ),
      }),
      annotations: { readOnlyHint: false },
    },
    async (params): Promise<CallToolResult> => {
      try {
        const report = await client.prepareArtifactPromotion(params);
        return {
          content: [{ type: "text", text: report }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to prepare artifact promotion: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
