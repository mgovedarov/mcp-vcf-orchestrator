import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { CatalogItemSchema } from "../types.js";
import type { VroClient } from "../vro-client.js";
import { truncationNote } from "./truncation.js";
import { listLimitSchema, limitNote } from "./list-limit.js";


/**
 * Render a catalog item's request schema as the input contract for
 * `create-deployment`.
 *
 * Without this the schema never reaches the caller: VCFA 9.1 serves
 * `schema.properties` and `schema.required`, and the tool rendered neither, so
 * an agent driving `create-deployment` through the MCP surface had no way to
 * discover an item's inputs and would have to guess them -- exactly what the
 * project's "do not invent environment-specific values" rule forbids
 * (VCFO-074).
 *
 * `default` is deliberately NOT rendered for a property marked
 * `encrypted: true`: a stored default on an encrypted input is a credential,
 * and printing it would breach the never-print-secrets rule. The property is
 * still listed, so the caller knows the input exists and must supply it.
 */
export function formatCatalogItemSchema(
  schema: CatalogItemSchema | undefined,
): string {
  const properties = schema?.properties;
  if (!properties || Object.keys(properties).length === 0) return "";

  const required = new Set(schema?.required ?? []);
  const lines = Object.entries(properties).map(([name, property]) => {
    const parts: string[] = [`• ${name}`];
    if (property?.type) parts.push(`(${property.type})`);
    if (required.has(name)) parts.push("required");
    if (property?.encrypted) parts.push("encrypted");
    let line = parts.join(" ");

    const label = property?.title ?? property?.description;
    if (label) line += ` — ${label}`;
    if (property?.pattern) line += `\n    pattern: ${property.pattern}`;
    if (Array.isArray(property?.enum) && property.enum.length > 0) {
      line += `\n    allowed: ${property.enum.map((value) => JSON.stringify(value)).join(", ")}`;
    }
    // An encrypted property's default is a stored secret; never print it.
    if (property?.default !== undefined && !property?.encrypted) {
      line += `\n    default: ${JSON.stringify(property.default)}`;
    }
    return line;
  });

  return `Request inputs (pass as create-deployment inputs):\n${lines.join("\n")}\n`;
}

export function registerCatalogTools(
  server: McpServer,
  client: VroClient,
): void {
  server.registerTool(
    "list-catalog-items",
    {
      title: "List Catalog Items",
      description:
        "List available catalog items from the VCF Automation Service Broker. Optionally narrow the inventory with a search.",
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe(
            "Search catalog items by name or description, as a case-insensitive substring matched client-side (VCF Automation 9.1 accepts the server-side search and ignores it)",
          ),
        limit: listLimitSchema,
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ search, limit }): Promise<CallToolResult> => {
      try {
        const result = await client.listCatalogItems(search, { limit });
        const items = result.content ?? [];
        if (items.length === 0) {
          return {
            content: [{ type: "text", text: `No catalog items found.${truncationNote(result, 0, result.totalElements)}` }],
          };
        }
        const lines = items.map((item) => {
          let line = `• ${item.name || "(unnamed)"} (id: ${item.id})`;
          if (item.type?.name) line += ` [${item.type.name}]`;
          if (item.description) line += ` — ${item.description}`;
          return line;
        });
        const total = limit === undefined ? result.totalElements ?? items.length : items.length;
        return {
          content: [
            {
              type: "text",
              text: `Found ${total} catalog item(s):\n\n${lines.join("\n")}${truncationNote(result, items.length, result.totalElements)}${limitNote(result, items.length, result.totalElements)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list catalog items: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get-catalog-item",
    {
      title: "Get Catalog Item",
      description:
        "Get detailed information about a specific catalog item by its ID.",
      inputSchema: z.object({
        id: z.string().describe("The catalog item ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const item = await client.getCatalogItem(id);
        let text = `Catalog Item: ${item.name || "(unnamed)"}\nID: ${item.id}\n`;
        if (item.description) text += `Description: ${item.description}\n`;
        if (item.type?.name) text += `Type: ${item.type.name}\n`;
        if (item.sourceType) text += `Source Type: ${item.sourceType}\n`;
        if (item.sourceName) text += `Source: ${item.sourceName}\n`;
        if (item.projectIds && item.projectIds.length > 0) {
          text += `Projects: ${item.projectIds.join(", ")}\n`;
        }
        if (item.createdBy) text += `Created By: ${item.createdBy}\n`;
        if (item.createdAt) text += `Created At: ${item.createdAt}\n`;
        if (item.lastUpdatedBy)
          text += `Last Updated By: ${item.lastUpdatedBy}\n`;
        if (item.lastUpdatedAt)
          text += `Last Updated At: ${item.lastUpdatedAt}\n`;
        if (item.isRequestable !== undefined)
          text += `Requestable: ${item.isRequestable}\n`;
        const schemaText = formatCatalogItemSchema(item.schema);
        if (schemaText) text += `\n${schemaText}`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get catalog item: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
