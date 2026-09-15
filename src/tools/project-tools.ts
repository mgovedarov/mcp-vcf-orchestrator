import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Project, ProjectPrincipal } from "../types.js";
import type { VroClient } from "../vro-client.js";
import { truncationNote } from "./truncation.js";
import { listLimitSchema, limitNote } from "./list-limit.js";

const NAMING_TEMPLATE_KEY = "__namingTemplate";
const PLACEMENT_POLICY_KEY = "__projectPlacementPolicy";

/**
 * Custom project properties are free-form key/value metadata. They are not
 * typed as secure the way configuration attributes are, so a value is
 * withheld whenever its key suggests credential material.
 */
const SENSITIVE_PROPERTY_KEY =
  /(password|passwd|secret|token|credential|private[-_]?key|api[-_]?key)/i;

/** A role array key this renderer knows by name. */
type RoleKey =
  | "administrators"
  | "members"
  | "viewers"
  | "supervisors"
  | "advancedUsers"
  | "users"
  | "auditors";

/**
 * The role arrays both platforms are known to serve, label first, in render
 * order. Only `administrators` is common to the two: vRA 8 serves `members`/
 * `viewers`/`supervisors`, VCF Automation 9.x serves `advancedUsers`/`users`/
 * `auditors` (VCFO-065). The order is fixed here rather than taken from the
 * response, so a platform's output does not change with the key order the
 * service happens to serve.
 */
const ROLE_ARRAYS: ReadonlyArray<readonly [string, RoleKey]> = [
  ["Administrators", "administrators"],
  ["Members", "members"],
  ["Viewers", "viewers"],
  ["Supervisors", "supervisors"],
  ["Advanced users", "advancedUsers"],
  ["Users", "users"],
  ["Auditors", "auditors"],
];

const KNOWN_ROLE_KEYS = new Set<string>(ROLE_ARRAYS.map(([, key]) => key));

function formatPrincipals(
  label: string,
  principals: ProjectPrincipal[] | undefined,
): string {
  if (!Array.isArray(principals)) return "";
  if (principals.length === 0) return `${label}: none\n`;
  const names = principals.map((principal) => {
    // Truthiness, not `??`: a principal carrying an empty email must render as
    // "(unnamed)" rather than as a blank name.
    const who = principal.email || "(unnamed)";
    return principal.type ? `${who} (${principal.type})` : who;
  });
  return `${label}: ${principals.length} — ${names.join(", ")}\n`;
}

/**
 * True for a non-empty array whose every entry is a principal-shaped object.
 * An empty array carries nothing to check, so it does not qualify.
 */
function isPrincipalArray(value: unknown): value is ProjectPrincipal[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        !Array.isArray(entry) &&
        ("email" in entry || "type" in entry),
    )
  );
}

/** `advancedUsers` -> `Advanced users`, for a role array we do not know. */
function humanizeRoleKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Render the role arrays: the known ones first in their fixed order, then any
 * further array of principal-shaped entries under a humanized form of its own
 * key. The second pass is what keeps a role array a future platform adds from
 * being dropped in silence, the way the 9.x arrays were before VCFO-065 — a
 * fixed list of names cannot print what it does not already name.
 *
 * The shape check is what keeps a non-role array out of the output, and it
 * needs an entry to look at, so an *unknown* array arriving empty is skipped —
 * which is how every role array on the one 9.1 project arrived. That costs at
 * most a `<label>: none` line for a role nobody holds, never a populated one.
 */
function formatRoleArrays(project: Project): string {
  let text = "";
  for (const [label, key] of ROLE_ARRAYS) {
    text += formatPrincipals(label, project[key]);
  }
  for (const [key, value] of Object.entries(project)) {
    if (KNOWN_ROLE_KEYS.has(key) || !isPrincipalArray(value)) continue;
    text += formatPrincipals(humanizeRoleKey(key), value);
  }
  return text;
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
  let text = `Project: ${project.name || "(unnamed)"}\nID: ${project.id}\n`;
  if (project.description) text += `Description: ${project.description}\n`;
  if (project.orgId) text += `Organization ID: ${project.orgId}\n`;
  if (typeof project.sharedResources === "boolean")
    text += `Shared resources: ${project.sharedResources ? "yes" : "no"}\n`;
  if (typeof project.operationTimeout === "number")
    text += `Operation timeout: ${project.operationTimeout}s\n`;
  text += formatProperties(project.properties);
  text += formatRoleArrays(project);
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
        "List VCF Automation projects. Use this to discover the projectId required by create-deployment, create-template, create-subscription, and the project-scoped list tools instead of guessing IDs. The optional search is a case-insensitive substring match on project name and description, sent to the project-service as an OData $filter so a narrower search reaches projects beyond the pagination cap; a service that rejects the filter falls back to a client-side match.",
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe(
            "Case-insensitive substring matched against project name and description",
          ),
        limit: listLimitSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ search, limit }): Promise<CallToolResult> => {
      try {
        const result = await client.listProjects(search, { limit });
        const items = result.content ?? [];
        const note = truncationNote(result, items.length, result.totalElements);
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
          let line = `• ${project.name || "(unnamed)"} (id: ${project.id})`;
          if (project.description) line += ` — ${project.description}`;
          return line;
        });
        const total = limit === undefined ? result.totalElements ?? items.length : items.length;
        return {
          content: [
            {
              type: "text",
              text: `Found ${total} project(s):\n\n${lines.join("\n")}${note}${limitNote(result, items.length, result.totalElements)}`,
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
        "Get details for a specific VCF Automation project by its ID: name, description, organization, shared-resources flag, operation timeout, machine naming template, placement policy, custom properties, role assignments, and placement constraint counts. The two platforms serve different role arrays — administrators, members, viewers and supervisors on vRA 8, administrators, advanced users, users and auditors on VCF Automation 9.x — and only the arrays the response carries are printed, so a section the response omits is absent rather than empty. Cloud zones are not part of this view. Use list-projects to discover project IDs.",
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
