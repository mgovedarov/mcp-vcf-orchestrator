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

function discoveryGuardrails(): string[] {
  return [
    "Discovery guardrail: if a required workflow, action, template, category, project, parameter, or return type is not found, stop and report the missing fact. Do not invent IDs, parameter names, types, schemas, or provider-specific YAML.",
    "Prefer reading vcfa://docs/artifact-authoring and the relevant vcfa://patterns/* or vcfa://schemas/* resource before drafting artifacts.",
  ];
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
          ...discoveryGuardrails(),
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
          ...discoveryGuardrails(),
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
          ...discoveryGuardrails(),
          "Summarize what already exists, what can be reused, and what gaps remain.",
          "Prefer concrete next tool calls and avoid creating or importing artifacts during discovery.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "vcfa-build-workflow-from-action",
    {
      title: "Build Workflow From Action",
      description:
        "Discover an existing action and scaffold a workflow wrapper around its verified contract.",
      argsSchema: {
        actionHint: z
          .string()
          .describe("Action name, module, ID, or fully qualified name hint"),
        workflowGoal: z
          .string()
          .describe("Desired workflow name or public behavior"),
        categoryHint: z
          .string()
          .optional()
          .describe("Optional workflow category name or path hint"),
      },
    },
    ({ actionHint, workflowGoal, categoryHint }) =>
      promptResult(
        "Build a vRO workflow wrapper from an existing action.",
        [
          `Action hint: ${actionHint}`,
          `Workflow goal: ${workflowGoal}`,
          categoryHint ? `Category hint: ${categoryHint}` : undefined,
          "",
          "Read vcfa://patterns/workflows/action-wrapper and vcfa://schemas/workflow-scaffold.",
          "Use list-actions with a focused filter, then get-action on the exact match to verify module, name, inputs, return type, and script behavior.",
          "Use list-categories for WorkflowCategory if the category is not already known.",
          ...discoveryGuardrails(),
          "Scaffold the wrapper with scaffold-workflow-file, preflight it, and summarize the exact import-workflow-file call only after preflight passes and the user confirms import.",
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n"),
      ),
  );

  server.registerPrompt(
    "vcfa-refactor-workflow",
    {
      title: "Refactor Workflow",
      description:
        "Inspect an existing workflow and plan a safe local artifact refactor.",
      argsSchema: {
        workflowHint: z
          .string()
          .describe("Workflow ID, name, or search hint for the workflow to refactor"),
        refactorGoal: z.string().describe("Desired refactor outcome"),
      },
    },
    ({ workflowHint, refactorGoal }) =>
      promptResult(
        "Refactor a vRO workflow safely.",
        [
          `Workflow hint: ${workflowHint}`,
          `Refactor goal: ${refactorGoal}`,
          "",
          "Use list-workflows and get-workflow to identify and inspect the existing workflow contract before proposing edits.",
          "Export the current workflow with export-workflow-file before preparing replacement artifacts.",
          "Read vcfa://docs/artifact-authoring and vcfa://patterns/workflows/basic-scriptable-task for scaffold and validation constraints.",
          ...discoveryGuardrails(),
          "Use preflight-workflow-file and diff-workflow-file before recommending import. Do not import until the user confirms target, overwrite intent, and risk.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "vcfa-create-template",
    {
      title: "Create Template",
      description:
        "Discover existing Cloud Assembly templates and draft a new blueprint template safely.",
      argsSchema: {
        templateGoal: z.string().describe("Template purpose or desired workload"),
        projectHint: z
          .string()
          .optional()
          .describe("Optional project name or ID hint"),
      },
    },
    ({ templateGoal, projectHint }) =>
      promptResult(
        "Create a VCFA blueprint template safely.",
        [
          `Template goal: ${templateGoal}`,
          projectHint ? `Project hint: ${projectHint}` : undefined,
          "",
          "Read vcfa://patterns/templates/conventions and vcfa://patterns/templates/small-vm or vcfa://patterns/templates/catalog-ready when relevant.",
          "Use list-templates and get-template to find reusable YAML conventions before drafting content.",
          "Use list-catalog-items or list-deployments when the template must align with catalog or deployment behavior.",
          ...discoveryGuardrails(),
          "Call create-template only after the target projectId and YAML content are confirmed, then verify with get-template.",
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n"),
      ),
  );

  server.registerPrompt(
    "vcfa-review-template",
    {
      title: "Review Template",
      description:
        "Inspect an existing blueprint template for correctness, reuse, and catalog readiness.",
      argsSchema: {
        templateId: z.string().describe("Template ID to review"),
        reviewGoal: z
          .string()
          .optional()
          .describe("Optional review focus, such as catalog readiness or small VM shape"),
      },
    },
    ({ templateId, reviewGoal }) =>
      promptResult(
        "Review a VCFA blueprint template.",
        [
          `Template ID: ${templateId}`,
          reviewGoal ? `Review focus: ${reviewGoal}` : undefined,
          "",
          "Use get-template to inspect metadata, validity, project, and YAML content.",
          "Compare against vcfa://patterns/templates/conventions and relevant template pattern resources.",
          "Use list-catalog-items or get-catalog-item when reviewing catalog-facing behavior.",
          ...discoveryGuardrails(),
          "Summarize concrete findings, missing facts, and any safe follow-up tool calls. Do not modify or delete templates during review.",
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n"),
      ),
  );

  server.registerPrompt(
    "vcfa-integrate-workflow-template-subscription",
    {
      title: "Integrate Workflow Template Subscription",
      description:
        "Plan integration between workflows, templates, catalog items, deployments, and extensibility subscriptions.",
      argsSchema: {
        integrationGoal: z.string().describe("Integration goal or lifecycle event"),
        workflowHint: z.string().optional().describe("Optional workflow hint"),
        templateHint: z.string().optional().describe("Optional template hint"),
      },
    },
    ({ integrationGoal, workflowHint, templateHint }) =>
      promptResult(
        "Plan VCFA workflow/template/subscription integration.",
        [
          `Integration goal: ${integrationGoal}`,
          workflowHint ? `Workflow hint: ${workflowHint}` : undefined,
          templateHint ? `Template hint: ${templateHint}` : undefined,
          "",
          "Use list-workflows/get-workflow, list-templates/get-template, list-catalog-items/get-catalog-item, list-event-topics, and list-subscriptions to map current state.",
          "Use list-deployments and list-deployment-actions if day-2 behavior matters.",
          ...discoveryGuardrails(),
          "Recommend create-subscription, update-subscription, template creation, or workflow import only as explicit next steps with required confirmations and risks.",
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n"),
      ),
  );

  server.registerPrompt(
    "vcfa-discovery-first-implementation-plan",
    {
      title: "Discovery First Implementation Plan",
      description:
        "Produce a concrete implementation plan that starts with verified VCFA/vRO discovery.",
      argsSchema: {
        goal: z.string().describe("Implementation goal"),
        artifactKinds: z
          .string()
          .optional()
          .describe("Optional artifact focus, such as workflows, actions, templates, or subscriptions"),
      },
    },
    ({ goal, artifactKinds }) =>
      promptResult(
        "Produce a discovery-first VCFA implementation plan.",
        [
          `Goal: ${goal}`,
          artifactKinds ? `Artifact focus: ${artifactKinds}` : undefined,
          "",
          "Start with read-only discovery calls relevant to the artifact focus: list-workflows, list-actions, list-configurations, list-resource-elements, list-templates, list-catalog-items, list-deployments, list-event-topics, list-subscriptions, list-categories, list-packages, and list-plugins.",
          "Read relevant vcfa://docs, vcfa://schemas, and vcfa://patterns resources before recommending artifact creation.",
          ...discoveryGuardrails(),
          "Return a phased plan with discovery, local artifact generation, preflight/diff, confirmation points, import or create calls, and post-change verification.",
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n"),
      ),
  );
}
