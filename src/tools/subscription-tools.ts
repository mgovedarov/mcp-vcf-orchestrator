import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { VroClient } from "../vro-client.js";

export function registerSubscriptionTools(
  server: McpServer,
  client: VroClient,
): void {
  // --- Event Topics ---

  server.registerTool(
    "list-event-topics",
    {
      title: "List Event Topics",
      description:
        "List available event topics from the VCF Automation Event Broker. Use this to discover topic IDs before creating subscriptions.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (): Promise<CallToolResult> => {
      try {
        const result = await client.listEventTopics();
        const topics = result.content ?? [];
        if (topics.length === 0) {
          return {
            content: [{ type: "text", text: "No event topics found." }],
          };
        }
        const lines = topics.map(
          (t) =>
            `• ${t.name} (id: ${t.id})${t.blockable ? " [blockable]" : ""}${t.description ? ` — ${t.description}` : ""}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Found ${topics.length} event topic(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list event topics: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // --- Subscriptions ---

  server.registerTool(
    "list-subscriptions",
    {
      title: "List Subscriptions",
      description:
        "List extensibility subscriptions from the VCF Automation Event Broker. Optionally filter by project ID.",
      inputSchema: z.object({
        projectId: z
          .string()
          .optional()
          .describe("Filter subscriptions by project ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }): Promise<CallToolResult> => {
      try {
        const result = await client.listSubscriptions(projectId);
        const subs = result.content ?? [];
        if (subs.length === 0) {
          return {
            content: [{ type: "text", text: "No subscriptions found." }],
          };
        }
        const lines = subs.map(
          (s) =>
            `• ${s.name} (id: ${s.id}) — topic: ${s.eventTopicId ?? "N/A"}, runnable: ${s.runnableType ?? "N/A"}/${s.runnableId ?? "N/A"}, ${s.disabled ? "DISABLED" : "ENABLED"}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Found ${subs.length} subscription(s):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list subscriptions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get-subscription",
    {
      title: "Get Subscription Details",
      description:
        "Get detailed information about a specific extensibility subscription.",
      inputSchema: z.object({
        id: z.string().describe("The subscription ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const sub = await client.getSubscription(id);

        let text = `Subscription: ${sub.name}\nID: ${sub.id}\n`;
        if (sub.description) text += `Description: ${sub.description}\n`;
        text += `Status: ${sub.disabled ? "DISABLED" : "ENABLED"}\n`;
        if (sub.eventTopicId) text += `Event Topic: ${sub.eventTopicId}\n`;
        if (sub.runnableType) text += `Runnable Type: ${sub.runnableType}\n`;
        if (sub.runnableId) text += `Runnable ID: ${sub.runnableId}\n`;
        if (sub.blocking !== undefined) text += `Blocking: ${sub.blocking}\n`;
        if (sub.priority !== undefined) text += `Priority: ${sub.priority}\n`;
        if (sub.timeout !== undefined) text += `Timeout: ${sub.timeout}\n`;
        if (sub.projectId) text += `Project ID: ${sub.projectId}\n`;
        if (sub.orgId) text += `Org ID: ${sub.orgId}\n`;
        if (sub.constraints) {
          text += `Constraints: ${JSON.stringify(sub.constraints, null, 2)}\n`;
        }

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get subscription: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "create-subscription",
    {
      title: "Create Subscription",
      description:
        "Create a new extensibility subscription in the VCF Automation Event Broker. Use list-event-topics to find the event topic ID first.",
      inputSchema: z.object({
        name: z.string().describe("Name for the subscription"),
        eventTopicId: z
          .string()
          .describe(
            "The event topic ID to subscribe to (use list-event-topics to find)",
          ),
        runnableType: z
          .enum(["extensibility.vro", "extensibility.abx"])
          .describe(
            "Type of runnable to trigger: extensibility.vro for a vRO workflow, extensibility.abx for an ABX action",
          ),
        runnableId: z
          .string()
          .describe("The ID of the workflow or ABX action to trigger"),
        projectId: z
          .string()
          .optional()
          .describe("Project ID to scope the subscription to"),
        description: z.string().optional().describe("Optional description"),
        blocking: z
          .boolean()
          .optional()
          .describe("Whether the subscription blocks the event pipeline"),
        priority: z
          .number()
          .optional()
          .describe("Subscription priority (lower number = higher priority)"),
        timeout: z
          .number()
          .optional()
          .describe("Timeout in minutes for the runnable execution"),
        disabled: z
          .boolean()
          .optional()
          .describe("Create the subscription in disabled state"),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      name,
      eventTopicId,
      runnableType,
      runnableId,
      projectId,
      description,
      blocking,
      priority,
      timeout,
      disabled,
    }): Promise<CallToolResult> => {
      try {
        const sub = await client.createSubscription({
          name,
          eventTopicId,
          runnableType,
          runnableId,
          projectId,
          description,
          blocking,
          priority,
          timeout,
          disabled,
        });
        return {
          content: [
            {
              type: "text",
              text: `Subscription created successfully.\nName: ${sub.name}\nID: ${sub.id}\nStatus: ${sub.disabled ? "DISABLED" : "ENABLED"}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to create subscription: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "update-subscription",
    {
      title: "Update Subscription",
      description:
        "Update an existing extensibility subscription. Use this to enable/disable, re-target, or change priority of a subscription.",
      inputSchema: z.object({
        id: z.string().describe("The subscription ID to update"),
        name: z.string().optional().describe("New name"),
        description: z.string().optional().describe("New description"),
        disabled: z
          .boolean()
          .optional()
          .describe("Set to true to disable, false to enable"),
        runnableId: z
          .string()
          .optional()
          .describe("New runnable (workflow/action) ID"),
        runnableType: z
          .enum(["extensibility.vro", "extensibility.abx"])
          .optional()
          .describe("New runnable type"),
        blocking: z.boolean().optional().describe("New blocking setting"),
        priority: z.number().optional().describe("New priority"),
        timeout: z.number().optional().describe("New timeout in minutes"),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({
      id,
      name,
      description,
      disabled,
      runnableId,
      runnableType,
      blocking,
      priority,
      timeout,
    }): Promise<CallToolResult> => {
      try {
        const sub = await client.updateSubscription(id, {
          name,
          description,
          disabled,
          runnableId,
          runnableType,
          blocking,
          priority,
          timeout,
        });
        return {
          content: [
            {
              type: "text",
              text: `Subscription updated successfully.\nName: ${sub.name}\nID: ${sub.id}\nStatus: ${sub.disabled ? "DISABLED" : "ENABLED"}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to update subscription: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "delete-subscription",
    {
      title: "Delete Subscription",
      description:
        "Delete an extensibility subscription from the VCF Automation Event Broker. Set confirm to true to proceed.",
      inputSchema: z.object({
        id: z.string().describe("The subscription ID to delete"),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm deletion. If false, the deletion will not proceed.",
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id, confirm }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm deletion of subscription ${id} by setting confirm to true. This action is irreversible.`,
            },
          ],
        };
      }
      try {
        await client.deleteSubscription(id);
        return {
          content: [
            {
              type: "text",
              text: `Subscription ${id} deleted successfully.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to delete subscription: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
