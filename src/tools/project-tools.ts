import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Project, ProjectList, ProjectPrincipal } from "../types.js";
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

const NAMING_TEMPLATE_KEY = "__namingTemplate";
const PLACEMENT_POLICY_KEY = "__projectPlacementPolicy";

/**
 * Custom project properties are free-form key/value metadata. They are not
 * typed as secure the way configuration attributes are, so a value is
 * withheld whenever its key suggests credential material.
 */
const SENSITIVE_PROPERTY_KEY =
  /(password|passwd|secret|token|credential|private[-_]?key|api[-_]?key)/i;

function formatPrincipals(
  label: string,
  principals: ProjectPrincipal[] | undefined,
): string {
  if (!Array.isArray(principals)) return "";
  if (principals.length === 0) return `${label}: none\n`;
  const names = principals.map((principal) => {
    const who = principal.email ?? "(unnamed)";
    return principal.type ? `${who} (${principal.type})` : who;
  });
  return `${label}: ${principals.length} — ${names.join(", ")}\n`;
}

function formatConstraints(constraints: Project["constraints"]): string {
  if (!constraints || typeof constraints !== "object") return "";
  const kinds = Object.entries(constraints).filter(
    ([, value]) => Array.isArray(value) && value.length > 0,
  );
  if (kinds.length === 0) return "Constraints: none\n";
  const summary = kinds
    .map(([kind, value]) => `${kind} ${(value as unknown[]).length}`)
    .join(", ");
  return `Constraints: ${summary}\n`;
}

function formatProperties(properties: Project["properties"]): string {
  if (!properties || typeof properties !== "object") return "";
  let text = "";
  const naming = properties[NAMING_TEMPLATE_KEY];
  if (typeof naming === "string" && naming.length > 0)
    text += `Machine naming template: ${naming}\n`;
  const placement = properties[PLACEMENT_POLICY_KEY];
  if (typeof placement === "string" && placement.length > 0)
    text += `Placement policy: ${placement}\n`;
  const custom = Object.entries(properties).filter(
    ([key]) => key !== NAMING_TEMPLATE_KEY && key !== PLACEMENT_POLICY_KEY,
  );
  if (custom.length === 0) return text;
  text += "Custom properties:\n";
  for (const [key, value] of custom) {
    const rendered = SENSITIVE_PROPERTY_KEY.test(key)
      ? "[redacted]"
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
    text += `  ${key}: ${rendered}\n`;
  }
  return text;
}

/**
 * Render a project for get-project. Only fields present in the response are
 * printed, so the output degrades to name/ID/description on a platform that
 * serves a narrower object.
 */
export function formatProjectDetails(project: Project): string {
  let text = `Project: ${project.name}\nID: ${project.id}\n`;
  if (project.description) text += `Description: ${project.description}\n`;
  if (project.orgId) text += `Organization ID: ${project.orgId}\n`;
  if (typeof project.sharedResources === "boolean")
    text += `Shared resources: ${project.sharedResources ? "yes" : "no"}\n`;
  if (typeof project.operationTimeout === "number")
    text += `Operation timeout: ${project.operationTimeout}s\n`;
  text += formatProperties(project.properties);
  text += formatPrincipals("Administrators", project.administrators);
  text += formatPrincipals("Members", project.members);
  text += formatPrincipals("Viewers", project.viewers);
  text += formatPrincipals("Supervisors", project.supervisors);
  text += formatConstraints(project.constraints);
  return text;
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
        "Get details for a specific VCF Automation project by its ID: name, description, organization, shared-resources flag, operation timeout, machine naming template, placement policy, custom properties, role assignments (administrators, members, viewers, supervisors), and placement constraint counts. Cloud zones are not part of this view. Use list-projects to discover project IDs.",
      inputSchema: z.object({
        id: z.string().describe("The project ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const project = await client.getProject(id);
        return {
          content: [{ type: "text", text: formatProjectDetails(project) }],
        };
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
