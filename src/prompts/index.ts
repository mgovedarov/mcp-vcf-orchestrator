import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

function promptResult(description: string, text: string): GetPromptResult {
  return {
    description,
    messages: [
      {
        role: "user",
        content: { type: "text", text },
      },
    ],
  };
}

export function registerVcfaPrompts(server: McpServer): void {
  server.registerPrompt(
    "vcfa-author-workflow",
    {
      title: "Author vRO Workflow",
      description:
        "Plan, scaffold, preflight, and safely import a vRO workflow artifact.",
      argsSchema: {
        goal: z.string().describe("Workflow goal or requirements"),
        categoryHint: z
          .string()
          .optional()
          .describe("Optional workflow category name or path hint"),
      },
    },
    ({ goal, categoryHint }) =>
      promptResult(
        "Author a vRO workflow artifact safely.",
        [
          `Goal: ${goal}`,
          categoryHint ? `Category hint: ${categoryHint}` : undefined,
          "",
          "Use VCFA MCP tools to inspect existing categories, workflows, and reusable actions before creating anything new.",
          "Prefer scaffold-workflow-file for local artifact generation, then run preflight-workflow-file and summarize any errors or warnings.",
          "Only recommend import-workflow-file after preflight passes and the user has confirmed the target category and import intent.",
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n"),
      ),
  );

  server.registerPrompt(
    "vcfa-review-artifact-import",
    {
      title: "Review Artifact Import",
      description:
        "Review a local workflow, action, configuration, or package artifact before import.",
      argsSchema: {
        artifactKind: z
          .enum(["workflow", "action", "configuration", "package"])
          .describe("Artifact kind to review"),
        fileName: z.string().describe("Local artifact file name"),
      },
    },
    ({ artifactKind, fileName }) =>
      promptResult(
        "Review a local artifact before import.",
        [
          `Artifact kind: ${artifactKind}`,
          `File name: ${fileName}`,
          "",
          "Run the matching preflight tool for this artifact and summarize blocking errors, warnings, metadata, parameters, and action references.",
          "Check the target category or package context with list-categories, list-packages, list-workflows, list-actions, or list-configurations as appropriate.",
          "Recommend the exact import tool call only after explaining risks and required confirmation.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "vcfa-troubleshoot-deployment",
    {
      title: "Troubleshoot Deployment",
      description:
        "Inspect a deployment and guide safe troubleshooting or remediation.",
      argsSchema: {
        deploymentId: z.string().describe("Deployment ID to troubleshoot"),
      },
    },
    ({ deploymentId }) =>
      promptResult(
        "Troubleshoot a VCFA deployment.",
        [
          `Deployment ID: ${deploymentId}`,
          "",
          "Read the deployment details and list available day-2 actions before recommending remediation.",
          "Use list-deployment-actions to identify safe operations and required inputs.",
          "Do not run deployment actions until the user confirms the action, inputs, and expected impact.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "vcfa-discover-capabilities",
    {
      title: "Discover VCFA Capabilities",
      description:
        "Explore installed plugins, categories, reusable actions, workflows, catalog items, and templates for a goal.",
      argsSchema: {
        goal: z
          .string()
          .optional()
          .describe("Optional automation or troubleshooting goal"),
      },
    },
    ({ goal }) =>
      promptResult(
        "Discover available VCFA capabilities.",
        [
          goal ? `Goal: ${goal}` : "Goal: discover relevant VCFA capabilities.",
          "",
          "Inspect installed plugins, relevant categories, existing workflows, reusable actions, catalog items, and templates before proposing new automation.",
          "Summarize what already exists, what can be reused, and what gaps remain.",
          "Prefer concrete next tool calls and avoid creating or importing artifacts during discovery.",
        ].join("\n"),
      ),
  );
}
