import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ProjectList } from "../types.js";
import type { VroClient } from "../vro-client.js";

/**
 * Truncation warning for list-projects. The shared truncationNote advises
 * narrowing the query with a filter, which does not apply here: the search is
 * applied client-side after pagination, so it can neither reduce the pages
 * fetched nor recover projects beyond the request cap. Reports the scanned
 * inventory (not the match count) so a partial scan is never mistaken for a
 * complete one.
 */
function projectTruncationNote(result: ProjectList): string {
  if (!result.truncated) return "";
  const scanned = result.scannedElements ?? result.content.length;
  const total = result.inventoryTotalElements ?? result.totalElements;
  const ofTotal =
    total !== undefined && total > scanned ? ` of ~${total}` : "";
  return `\n\n⚠️ Results truncated: the pagination request limit was reached after scanning ${scanned}${ofTotal} project(s). Projects beyond that point were not checked, and the search filter is applied client-side so it cannot retrieve them; treat missing matches as unverified and use get-project with a known ID instead.`;
}

export function registerProjectTools(
  server: McpServer,
  client: VroClient,
): void {
  server.registerTool(
    "list-projects",
    {
      title: "List Projects",
      description:
        "List VCF Automation projects. Use this to discover the projectId required by create-deployment, create-template, create-subscription, and the project-scoped list tools instead of guessing IDs. The optional search is a case-insensitive substring match on project name and description, applied after the full project list is collected.",
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe(
            "Case-insensitive substring matched against project name and description",
          ),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ search }): Promise<CallToolResult> => {
      try {
        const result = await client.listProjects(search);
        const items = result.content ?? [];
        const note = projectTruncationNote(result);
        if (items.length === 0) {
          // Mirror the client's trimming so the message only claims a filter
          // was applied when one actually was.
          const needle = search?.trim();
          const text = needle
            ? `No projects found matching "${needle}".`
            : "No projects found.";
          return { content: [{ type: "text", text: `${text}${note}` }] };
        }
        const lines = items.map((project) => {
          let line = `• ${project.name} (id: ${project.id})`;
          if (project.description) line += ` — ${project.description}`;
          return line;
        });
        const total = result.totalElements ?? items.length;
        return {
          content: [
            {
              type: "text",
              text: `Found ${total} project(s):\n\n${lines.join("\n")}${note}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list projects: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get-project",
    {
      title: "Get Project",
      description:
        "Get details for a specific VCF Automation project by its ID. Use list-projects to discover project IDs.",
      inputSchema: z.object({
        id: z.string().describe("The project ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const project = await client.getProject(id);
        let text = `Project: ${project.name}\nID: ${project.id}\n`;
        if (project.description)
          text += `Description: ${project.description}\n`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get project: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
