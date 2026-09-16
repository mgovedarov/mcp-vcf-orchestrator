import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type {
  CatalogItemRequestEntry,
  CatalogItemRequestResponse,
  Deployment,
  DeploymentAction,
  DeploymentActionList,
  DeploymentRequest,
} from "../types.js";
import type { VroClient } from "../vro-client.js";
import { truncationNote } from "./truncation.js";
import { listLimitSchema, limitNote } from "./list-limit.js";
import { DESTRUCTIVE_LIVE_WRITE } from "./annotations.js";
import {
  guardExpectedFields,
  hasAnyExpectedValue,
} from "./confirmation-guards.js";

function isInputArray(value: unknown): value is {
  name?: string;
  label?: string;
  type?: string;
  description?: string;
  required?: boolean;
}[] {
  return Array.isArray(value);
}

function getDeploymentActionInputHints(action: DeploymentAction): string[] {
  const inputSource = action.inputParameters ?? action.inputs;
  if (isInputArray(inputSource)) {
    return inputSource
      .map((input) => {
        const name = input.name ?? input.label;
        if (!name) return undefined;
        let hint = `${name}`;
        if (input.type) hint += ` (${input.type})`;
        if (input.required) hint += " required";
        if (input.description) hint += ` — ${input.description}`;
        return hint;
      })
      .filter((hint): hint is string => Boolean(hint));
  }

  if (inputSource && typeof inputSource === "object") {
    return Object.keys(inputSource);
  }

  return [];
}

/**
 * VCFA 9.1 serves a **bare array** here, not a Spring page (VCFO-074). Both
 * arms are kept: one lab is not a contract, and the page arm costs nothing.
 */
function normalizeDeploymentActionList(result: DeploymentActionList): {
  actions: DeploymentAction[];
  total: number;
} {
  if (Array.isArray(result)) {
    return { actions: result, total: result.length };
  }

  const actions = result.content ?? [];
  return { actions, total: result.totalElements ?? actions.length };
}

/**
 * Pull the requested deployments out of the catalog request response.
 *
 * `POST /catalog/api/items/{id}/request` answers a bare array of
 * `{deploymentId, deploymentName}` on VCFA 9.1 -- no `id`, no `name`, no
 * `status` (VCFO-074). The client used to type it as a single `Deployment`, so
 * every identifier read off it was `undefined` and `create-deployment` printed
 * a bare "Deployment request submitted." with nothing to follow up on. The
 * caller then had to recover the id from `list-deployments` by name, which is
 * ambiguous the moment two deployments share one.
 *
 * Both the array and the single-object arm are accepted, and both key
 * spellings, so a platform answering either shape still yields identifiers.
 */
export function normalizeCatalogItemRequest(
  result: CatalogItemRequestResponse | Record<string, unknown> | undefined,
): { deploymentId?: string; deploymentName?: string; status?: string }[] {
  if (result === undefined || result === null) return [];
  const entries: CatalogItemRequestEntry[] = (
    Array.isArray(result) ? result : [result]
  ) as CatalogItemRequestEntry[];
  return entries
    .filter((entry): entry is CatalogItemRequestEntry => Boolean(entry))
    .map((entry) => ({
      deploymentId: entry.deploymentId ?? entry.id,
      deploymentName: entry.deploymentName ?? entry.name,
      status: entry.status,
    }))
    .filter(
      (entry) =>
        entry.deploymentId !== undefined ||
        entry.deploymentName !== undefined ||
        entry.status !== undefined,
    );
}

export function formatDeploymentActions(
  deploymentId: string,
  actions: DeploymentAction[],
  total = actions.length,
): string {
  if (actions.length === 0) {
    return `No deployment actions found for deployment ${deploymentId}.`;
  }

  const lines = actions.map((action) => {
    const name = action.name ?? action.displayName ?? action.id;
    let line = `• ${name} (id: ${action.id})`;
    if (action.description) line += ` — ${action.description}`;

    const inputHints = getDeploymentActionInputHints(action);
    if (inputHints.length > 0) {
      line += `\n  inputs: ${inputHints.join(", ")}`;
    }
    return line;
  });

  return `Found ${total} deployment action(s) for deployment ${deploymentId}:\n\n${lines.join("\n")}`;
}

export function formatDeploymentRequest(request: DeploymentRequest): string {
  let text = "Deployment action request submitted.\n";
  if (request.id) text += `ID: ${request.id}\n`;
  if (request.name) text += `Name: ${request.name}\n`;
  if (request.actionId) text += `Action ID: ${request.actionId}\n`;
  if (request.deploymentId) text += `Deployment ID: ${request.deploymentId}\n`;
  if (request.status) text += `Status: ${request.status}\n`;
  if (request.details) text += `Details: ${request.details}\n`;
  return text;
}

/**
 * Verify a catalog item and a project against the `expected*` arguments before
 * `create-deployment` requests real infrastructure.
 *
 * `create-deployment` takes two opaque UUIDs and nothing else identifies the
 * target, so a transposed id requests a different blueprint into a different
 * project and the tool reports success (VCFO-084). Its siblings
 * `delete-deployment` and `run-deployment-action` already re-read the live
 * object first; this brings the one tool that *provisions* into the same
 * two-phase flow.
 *
 * Both names need the `guardResourceTarget` treatment from VCFO-077, because
 * both are optional on the wire: `CatalogItem.name` is absent on shapes that
 * have never been observed, and a real 9.1 item is both narrower and wider
 * than the interface claims. Feeding an absent value straight into
 * `guardExpectedFields` reports it as a mismatch against "(missing)", which
 * would refuse every legitimate call on a platform that omits the field. So
 * absence is reported as "cannot verify here" -- and it still refuses, because
 * a caller who asked for two-phase verification must not be told the target
 * was confirmed when it was not.
 *
 * The catalog item is checked FIRST: deploying the wrong blueprint is the more
 * urgent signal, and the caller would otherwise be told to fix the project only
 * to hit the blueprint mismatch a round-trip later.
 *
 * Only the *names* are offered. An `expectedProjectId` or `expectedCatalogItemId`
 * would look like verification and be incapable of failing: unlike
 * `delete-deployment`, where `projectId` is a property of a live deployment the
 * caller never typed, here both IDs are required arguments of this very call, so
 * `getProject(projectId).id` echoes the input back by construction. The names
 * are the datum the operator actually read during discovery, and they are
 * exactly what a transposed UUID silently changes.
 *
 * Each read is made only when an argument needs it, so a caller passing no
 * `expected*` value costs exactly what it did before.
 */
async function guardCreateDeploymentTarget(
  client: Pick<VroClient, "getCatalogItem" | "getProject">,
  catalogItemId: string,
  projectId: string,
  expectedCatalogItemName: string | undefined,
  expectedProjectName: string | undefined,
): Promise<CallToolResult | undefined> {
  if (expectedCatalogItemName !== undefined) {
    let item;
    try {
      item = await client.getCatalogItem(catalogItemId);
    } catch (error) {
      return unreadableTarget(
        "expectedCatalogItemName",
        `catalog item ${catalogItemId}`,
        error,
      );
    }
    if (!item.name) {
      return unverifiableTarget(
        "expectedCatalogItemName",
        `catalog item ${catalogItemId}`,
        "confirm it with list-catalog-items",
      );
    }
    const guard = guardExpectedFields(`catalog item ${catalogItemId}`, [
      {
        label: "catalog item name",
        expected: expectedCatalogItemName,
        actual: item.name,
      },
    ]);
    if (guard) return guard;
  }

  if (expectedProjectName === undefined) return undefined;

  let project;
  try {
    project = await client.getProject(projectId);
  } catch (error) {
    return unreadableTarget(
      "expectedProjectName",
      `project ${projectId}`,
      error,
    );
  }
  if (!project.name) {
    return unverifiableTarget(
      "expectedProjectName",
      `project ${projectId}`,
      "confirm it with list-projects",
    );
  }

  return guardExpectedFields(`project ${projectId}`, [
    {
      label: "project name",
      expected: expectedProjectName,
      actual: project.name,
    },
  ]);
}

/**
 * The refusal for a verification read that failed outright.
 *
 * This is deliberately not left to the handler's outer catch: reported as
 * `Failed to create deployment: <message>`, an operator cannot tell whether
 * anything was provisioned before it failed. Naming the read says plainly that
 * the request was never submitted.
 */
function unreadableTarget(
  argument: string,
  target: string,
  error: unknown,
): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: "text",
        text: `Cannot verify ${argument}: reading ${target} failed: ${message}. No deployment was requested.`,
      },
    ],
    isError: true,
  };
}

/**
 * The refusal for an expected value the live record cannot confirm either way.
 * Shaped like the resource-element one (VCFO-077): it names the argument, says
 * why it could not be checked, and states that nothing was provisioned.
 */
function unverifiableTarget(
  argument: string,
  target: string,
  remedy: string,
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: `Cannot verify ${argument} for ${target}: the live record reports no name, so the value cannot be confirmed either way. No deployment was requested. Omit ${argument} and ${remedy}, or re-run with the other expected fields only.`,
      },
    ],
    isError: true,
  };
}

/**
 * Resolve the project name to compare `expectedProjectName` against.
 *
 * A deployment on VCFA 9.1 carries `projectId` but **no `projectName`**
 * (VCFO-074). Comparing the expected value straight against
 * `deployment.projectName` therefore reports `found (missing)` and refuses
 * every legitimate call -- the exact defect VCFO-077 fixed for resource
 * elements, reintroduced here through a field that was assumed rather than
 * observed.
 *
 * So the name is taken from the deployment when a platform does serve it, and
 * otherwise resolved through the project service using the deployment's own
 * `projectId`. That keeps the argument meaningful instead of merely failing
 * politely, and matches how `guardCreateDeploymentTarget` already resolves it.
 *
 * Returns `undefined` for the name when neither source has one, which the
 * caller reports as unverifiable rather than as a mismatch.
 */
async function resolveDeploymentProjectName(
  client: Pick<VroClient, "getProject">,
  deployment: Deployment,
): Promise<{ name?: string; error?: unknown }> {
  if (deployment.projectName) return { name: deployment.projectName };
  if (!deployment.projectId) return {};
  try {
    const project = await client.getProject(deployment.projectId);
    return { name: project.name };
  } catch (error) {
    return { error };
  }
}

/**
 * Compare `expectedProjectName` against the resolved live project name.
 *
 * Kept separate from the other expected fields because it is the only one that
 * may need a second read, and because "cannot verify" must not be reported as
 * a mismatch.
 */
async function guardDeploymentProjectName(
  client: Pick<VroClient, "getProject">,
  target: string,
  deployment: Deployment,
  expectedProjectName: string | undefined,
  operation: string,
): Promise<CallToolResult | undefined> {
  if (expectedProjectName === undefined) return undefined;

  const { name, error } = await resolveDeploymentProjectName(
    client,
    deployment,
  );
  if (error !== undefined) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Cannot verify expectedProjectName for ${target}: reading project ${deployment.projectId} failed: ${message}. ${operation}`,
        },
      ],
      isError: true,
    };
  }
  if (!name) {
    return {
      content: [
        {
          type: "text",
          text: `Cannot verify expectedProjectName for ${target}: neither the deployment nor its project reports a name, so the value cannot be confirmed either way. ${operation} Omit expectedProjectName and confirm the project with list-projects, or re-run with the other expected fields only.`,
        },
      ],
      isError: true,
    };
  }

  return guardExpectedFields(target, [
    {
      label: "project name",
      expected: expectedProjectName,
      actual: name,
    },
  ]);
}

export function registerDeploymentTools(
  server: McpServer,
  client: VroClient,
): void {
  server.registerTool(
    "list-deployments",
    {
      title: "List Deployments",
      description:
        "List deployments in VCF Automation. Optionally filter by name/keyword search or by project ID. Use list-projects to discover project IDs.",
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe("Search deployments by name or keyword"),
        limit: listLimitSchema,
        projectId: z
          .string()
          .optional()
          .describe(
            "Filter deployments by project ID (discover with list-projects)",
          ),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ search, projectId, limit }): Promise<CallToolResult> => {
      try {
        const result = await client.listDeployments(search, projectId, { limit });
        const items = result.content ?? [];
        if (items.length === 0) {
          return {
            content: [{ type: "text", text: `No deployments found.${limit !== undefined ? truncationNote(result, 0, result.totalElements) : ""}` }],
          };
        }
        const lines = items.map((d) => {
          let line = `• ${d.name || "(unnamed)"} (id: ${d.id})`;
          if (d.status) line += ` [${d.status}]`;
          if (d.projectName) line += ` — project: ${d.projectName}`;
          else if (d.projectId) line += ` — projectId: ${d.projectId}`;
          return line;
        });
        const total = limit === undefined ? result.totalElements ?? items.length : items.length;
        return {
          content: [
            {
              type: "text",
              text: `Found ${total} deployment(s):\n\n${lines.join("\n")}${truncationNote(result, items.length, result.totalElements)}${limitNote(result, items.length, result.totalElements)}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list deployments: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get-deployment",
    {
      title: "Get Deployment",
      description:
        "Get detailed information about a specific deployment by its ID.",
      inputSchema: z.object({
        id: z.string().describe("The deployment ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }): Promise<CallToolResult> => {
      try {
        const d = await client.getDeployment(id);
        let text = `Deployment: ${d.name || "(unnamed)"}\nID: ${d.id}\n`;
        if (d.status) text += `Status: ${d.status}\n`;
        if (d.description) text += `Description: ${d.description}\n`;
        if (d.projectName) text += `Project: ${d.projectName}\n`;
        else if (d.projectId) text += `Project ID: ${d.projectId}\n`;
        if (d.catalogItemId) text += `Catalog Item ID: ${d.catalogItemId}\n`;
        if (d.catalogItemVersion)
          text += `Catalog Item Version: ${d.catalogItemVersion}\n`;
        if (d.ownedBy) text += `Owned By: ${d.ownedBy}\n`;
        if (d.createdBy) text += `Created By: ${d.createdBy}\n`;
        if (d.createdAt) text += `Created At: ${d.createdAt}\n`;
        if (d.lastUpdatedBy) text += `Last Updated By: ${d.lastUpdatedBy}\n`;
        if (d.lastUpdatedAt) text += `Last Updated At: ${d.lastUpdatedAt}\n`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get deployment: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "delete-deployment",
    {
      title: "Delete Deployment",
      description:
        "Delete a deployment by its ID. Set confirm to true to proceed.",
      inputSchema: z.object({
        id: z.string().describe("The deployment ID to delete"),
        expectedName: z
          .string()
          .optional()
          .describe(
            "Optional expected deployment name verified before deletion",
          ),
        expectedProjectId: z
          .string()
          .optional()
          .describe(
            "Optional expected deployment project ID verified before deletion",
          ),
        expectedProjectName: z
          .string()
          .optional()
          .describe(
            "Optional expected deployment project name verified before deletion",
          ),
        expectedStatus: z
          .string()
          .optional()
          .describe(
            "Optional expected deployment status verified before deletion",
          ),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm deletion. If false, the deletion will not proceed.",
          ),
      }),
      annotations: DESTRUCTIVE_LIVE_WRITE,
    },
    async ({
      id,
      expectedName,
      expectedProjectId,
      expectedProjectName,
      expectedStatus,
      confirm,
    }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm deletion of deployment ${id} by setting confirm to true. This action is irreversible.`,
            },
          ],
        };
      }
      try {
        if (
          hasAnyExpectedValue({
            expectedName,
            expectedProjectId,
            expectedProjectName,
            expectedStatus,
          })
        ) {
          const deployment = await client.getDeployment(id);
          const guard = guardExpectedFields(`deployment ${id}`, [
            {
              label: "deployment name",
              expected: expectedName,
              actual: deployment.name,
            },
            {
              label: "project ID",
              expected: expectedProjectId,
              actual: deployment.projectId,
            },
            {
              label: "status",
              expected: expectedStatus,
              actual: deployment.status,
            },
          ]);
          if (guard) return guard;

          const projectGuard = await guardDeploymentProjectName(
            client,
            `deployment ${id}`,
            deployment,
            expectedProjectName,
            "The deployment was not deleted.",
          );
          if (projectGuard) return projectGuard;
        }

        await client.deleteDeployment(id);
        return {
          content: [
            { type: "text", text: `Deployment ${id} deleted successfully.` },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to delete deployment: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "create-deployment",
    {
      title: "Create Deployment",
      description:
        "Create a new deployment from a catalog item. This provisions real infrastructure. Use list-catalog-items to find the catalog item ID, list-projects to find the project ID, and list-deployments to verify afterwards. Both IDs are opaque, so pass expectedCatalogItemName and expectedProjectName to bind the request to the target you discovered: each is verified against live metadata first, and a mismatch refuses before anything is provisioned. In VCFA_TARGET_PLATFORM=vra8 mode the catalog-service request is unsupported and refused, but any expected-field reads are made first, so the refusal arrives after them.",
      inputSchema: z.object({
        catalogItemId: z.string().describe("The catalog item ID to deploy"),
        deploymentName: z.string().describe("Name for the new deployment"),
        projectId: z
          .string()
          .describe(
            "The project ID in which to create the deployment (discover with list-projects)",
          ),
        version: z
          .string()
          .optional()
          .describe("Catalog item version to deploy (defaults to latest)"),
        reason: z
          .string()
          .optional()
          .describe("Reason or comment for the deployment request"),
        inputs: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Catalog item input parameters as a key/value object"),
        expectedCatalogItemName: z
          .string()
          .optional()
          .describe(
            "Optional expected catalog item name verified against live metadata before the deployment is requested",
          ),
        expectedProjectName: z
          .string()
          .optional()
          .describe(
            "Optional expected project name verified against live metadata before the deployment is requested",
          ),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm deployment creation. If false, the deployment request will not be submitted.",
          ),
      }),
      annotations: DESTRUCTIVE_LIVE_WRITE,
    },
    async ({
      catalogItemId,
      deploymentName,
      projectId,
      version,
      reason,
      inputs,
      expectedCatalogItemName,
      expectedProjectName,
      confirm,
    }): Promise<CallToolResult> => {
      const verifiesTarget = hasAnyExpectedValue({
        expectedCatalogItemName,
        expectedProjectName,
      });

      if (!confirm) {
        const impact = verifiesTarget
          ? "The catalog item and project will be verified against live metadata first."
          : "No expected target fields were supplied, so the catalog item and project IDs will not be verified against live metadata before the request.";
        return {
          content: [
            {
              type: "text",
              text: `Confirm deployment of catalog item ${catalogItemId} as ${deploymentName} in project ${projectId} by setting confirm to true. This provisions real infrastructure, with the cost and capacity that follow from it, and removing it later means deleting the deployment. ${impact}`,
            },
          ],
        };
      }

      try {
        if (verifiesTarget) {
          const guard = await guardCreateDeploymentTarget(
            client,
            catalogItemId,
            projectId,
            expectedCatalogItemName,
            expectedProjectName,
          );
          if (guard) return guard;
        }

        const response = await client.createDeploymentFromCatalogItem({
          catalogItemId,
          deploymentName,
          projectId,
          version,
          reason,
          inputs,
        });
        const requested = normalizeCatalogItemRequest(response);
        let text = `Deployment request submitted.\n`;
        if (requested.length === 0) {
          // The request was accepted but carried nothing identifying. Say so,
          // rather than leaving the caller to guess whether it was a no-op.
          text += `The service returned no deployment identifier. Find the deployment with list-deployments (projectId: ${projectId}) and verify it is the one just requested before acting on it.\n`;
        }
        for (const entry of requested) {
          if (entry.deploymentId) text += `ID: ${entry.deploymentId}\n`;
          if (entry.deploymentName) text += `Name: ${entry.deploymentName}\n`;
          if (entry.status) text += `Status: ${entry.status}\n`;
        }
        if (requested.length > 0) {
          text += `Provisioning is asynchronous: poll get-deployment until the status is terminal.\n`;
        }
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to create deployment: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "list-deployment-actions",
    {
      title: "List Deployment Actions",
      description:
        "List deployment-level day-2 actions available for a VCF Automation deployment.",
      inputSchema: z.object({
        deploymentId: z.string().describe("The deployment ID"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ deploymentId }): Promise<CallToolResult> => {
      try {
        const result = await client.listDeploymentActions(deploymentId);
        const { actions, total } = normalizeDeploymentActionList(result);
        return {
          content: [
            {
              type: "text",
              text: formatDeploymentActions(deploymentId, actions, total),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list deployment actions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "run-deployment-action",
    {
      title: "Run Deployment Action",
      description:
        "Run a deployment-level day-2 action. Use list-deployment-actions first to find the action ID and any required inputs. Set confirm to true to proceed.",
      inputSchema: z.object({
        deploymentId: z.string().describe("The deployment ID"),
        actionId: z.string().describe("The deployment action ID to run"),
        reason: z
          .string()
          .optional()
          .describe("Reason for requesting the day-2 action"),
        inputs: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Day-2 action inputs as a key/value object"),
        expectedDeploymentName: z
          .string()
          .optional()
          .describe(
            "Optional expected deployment name verified before submitting the day-2 action",
          ),
        expectedProjectId: z
          .string()
          .optional()
          .describe(
            "Optional expected deployment project ID verified before submitting the day-2 action",
          ),
        expectedProjectName: z
          .string()
          .optional()
          .describe(
            "Optional expected deployment project name verified before submitting the day-2 action",
          ),
        expectedStatus: z
          .string()
          .optional()
          .describe(
            "Optional expected deployment status verified before submitting the day-2 action",
          ),
        expectedActionName: z
          .string()
          .optional()
          .describe(
            "Optional expected deployment action name verified against the current action list before submitting",
          ),
        confirm: z
          .boolean()
          .describe(
            "Must be set to true to confirm the day-2 action request. If false, the request will not be submitted.",
          ),
      }),
      annotations: DESTRUCTIVE_LIVE_WRITE,
    },
    async ({
      deploymentId,
      actionId,
      reason,
      inputs,
      expectedDeploymentName,
      expectedProjectId,
      expectedProjectName,
      expectedStatus,
      expectedActionName,
      confirm,
    }): Promise<CallToolResult> => {
      if (!confirm) {
        return {
          content: [
            {
              type: "text",
              text: `Confirm running deployment action ${actionId} on deployment ${deploymentId} by setting confirm to true. Day-2 actions may change or delete deployment resources.`,
            },
          ],
        };
      }

      try {
        if (
          hasAnyExpectedValue({
            expectedDeploymentName,
            expectedProjectId,
            expectedProjectName,
            expectedStatus,
          })
        ) {
          const deployment = await client.getDeployment(deploymentId);
          const guard = guardExpectedFields(`deployment ${deploymentId}`, [
            {
              label: "deployment name",
              expected: expectedDeploymentName,
              actual: deployment.name,
            },
            {
              label: "project ID",
              expected: expectedProjectId,
              actual: deployment.projectId,
            },
            {
              label: "status",
              expected: expectedStatus,
              actual: deployment.status,
            },
          ]);
          if (guard) return guard;

          const projectGuard = await guardDeploymentProjectName(
            client,
            `deployment ${deploymentId}`,
            deployment,
            expectedProjectName,
            "No day-2 action was submitted.",
          );
          if (projectGuard) return projectGuard;
        }

        if (expectedActionName !== undefined) {
          const { actions } = normalizeDeploymentActionList(
            await client.listDeploymentActions(deploymentId),
          );
          const action = actions.find((candidate) => candidate.id === actionId);
          const actionGuard = guardExpectedFields(
            `deployment action ${actionId}`,
            [
              {
                label: "action name",
                expected: expectedActionName,
                actual: action?.name ?? action?.displayName,
              },
            ],
          );
          if (actionGuard) return actionGuard;
        }

        const request = await client.runDeploymentAction({
          deploymentId,
          actionId,
          reason,
          inputs,
        });
        return {
          content: [{ type: "text", text: formatDeploymentRequest(request) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to run deployment action: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
