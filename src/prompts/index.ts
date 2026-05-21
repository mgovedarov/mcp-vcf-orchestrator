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

function buildPromptText(lines: (string | undefined)[]): string {
  return lines.filter((line): line is string => line !== undefined).join("\n");
}

function discoveryGuardrails(): string[] {
  return [
    "Discovery guardrail: if a required workflow, action, template, category, project, parameter, or return type is not found, stop and report the missing fact. Do not invent IDs, parameter names, types, schemas, or provider-specific YAML.",
    "When action discovery is required, list-actions must produce an exact candidate and get-action must verify its contract. If list-actions returns no match or only partial/ambiguous action data, stop and ask for the missing action details instead of inventing parameter names or return types.",
    "Workflow authoring preference: when a workflow only executes one existing vRO action, use a native action workflow item instead of a scriptable task that calls System.getModule. Use scriptable tasks when the workflow item performs multiple action calls or additional orchestration logic.",
    "Workflow layout preference: when authoring or editing workflow XML/package content, arrange sequential workflow items horizontally from left to right.",
    "Workflow input form preference: generated workflows with inputs must include a valid input_form_ entry. Use page-level titles, section objects with only id and fields, field IDs that match schema keys, and options.externalValidations: []. Do not add section title or unverified field properties such as size.",
    "Publish reusable vRO content through the configured project package by default: ensure-project-package, add content, rebuild-project-package, export-project-package, inspect import details, and import-project-package. Use direct artifact imports only for narrow validation or explicitly requested one-off tests.",
    "Two-phase confirmation preference: after discovery, include expected target fields such as expectedName, expectedWorkflowName, expectedCategoryName, expectedPackageName, expectedDeploymentName, expectedActionName, expectedEventTopicId, or expectedRunnableId in confirmed mutation calls when the tool supports them.",
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
        buildPromptText([
          `Goal: ${goal}`,
          categoryHint ? `Category hint: ${categoryHint}` : undefined,
          "",
          "Use VCFA MCP tools to inspect existing categories, workflows, and reusable actions before creating anything new.",
          ...discoveryGuardrails(),
          "Prefer scaffold-workflow-file for local artifact generation, then run preflight-workflow-file and summarize any errors or warnings.",
          "For reusable workflow content, recommend adding the workflow to the project package and importing the package. Only recommend direct import-workflow-file for narrow validation or explicitly requested one-off tests after preflight passes and the user confirms the target category and import intent; include expectedCategoryId or expectedCategoryName when available.",
        ]),
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
        buildPromptText([
          `Artifact kind: ${artifactKind}`,
          `File name: ${fileName}`,
          "",
          "Run the matching preflight tool for this artifact and summarize blocking errors, warnings, metadata, parameters, and action references.",
          ...discoveryGuardrails(),
          "Check the target category or package context with list-categories, list-packages, list-workflows, list-actions, or list-configurations as appropriate.",
          "For reusable project content, recommend the package import path. Recommend a direct artifact import only after explaining why it is a validation or one-off import, plus the risks and required confirmation; include expected category or package fields when available.",
        ]),
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
        goalHint: z
          .string()
          .optional()
          .describe("Optional troubleshooting focus or symptom description"),
      },
    },
    ({ deploymentId, goalHint }) =>
      promptResult(
        "Troubleshoot a VCFA deployment.",
        buildPromptText([
          `Deployment ID: ${deploymentId}`,
          goalHint ? `Troubleshooting focus: ${goalHint}` : undefined,
          "",
          "Use get-deployment to inspect the deployment state, status, resources, and last operation before proposing remediation.",
          "Use list-catalog-items or get-catalog-item when the deployment origin or catalog source is unclear.",
          "Use list-deployment-actions to identify available day-2 operations and their required inputs.",
          ...discoveryGuardrails(),
          "Irreversible actions such as destroy or delete require extra confirmation including the deployment name, expected data loss, and explicit user acknowledgement before execution.",
          "Do not run deployment actions until the user confirms the action, inputs, target deployment, and expected impact. Pass expectedDeploymentName and expectedActionName when submitting the confirmed action.",
        ]),
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
        buildPromptText([
          goal ? `Goal: ${goal}` : "Goal: discover relevant VCFA capabilities.",
          "",
          "Inspect installed plugins, relevant categories, existing workflows, reusable actions, catalog items, and templates before proposing new automation.",
          "Use list-workflows-by-category when folder membership matters, for example to see all workflows under a specific category tree.",
          ...discoveryGuardrails(),
          "Summarize what already exists, what can be reused, and what gaps remain.",
          "Prefer concrete next tool calls and avoid creating or importing artifacts during discovery.",
        ]),
      ),
  );

  server.registerPrompt(
    "vcfa-collect-context-snapshot",
    {
      title: "Collect Context Snapshot",
      description:
        "Collect and persist reusable VCFA/vRO context for future agents.",
      argsSchema: {
        goal: z
          .string()
          .optional()
          .describe("Optional project or implementation goal for the snapshot"),
        includeOptionalDomains: z
          .boolean()
          .optional()
          .describe(
            "Whether to include templates, catalog items, event topics, subscriptions, packages, and plugins",
          ),
        profile: z
          .enum(["default", "vcfaBuiltIns"])
          .optional()
          .describe(
            "Snapshot profile. Use vcfaBuiltIns for workflows in subfolders below Library and actions in com.vmware modules.",
          ),
      },
    },
    ({ goal, includeOptionalDomains, profile }) =>
      promptResult(
        "Collect reusable VCFA/vRO context.",
        buildPromptText([
          goal ? `Goal: ${goal}` : "Goal: create reusable VCFA/vRO context.",
          `Profile: ${profile ?? "default"}`,
          `Include optional domains: ${includeOptionalDomains === true ? "yes" : "no"}`,
          "",
          "Use collect-context-snapshot before major workflow, action, template, or subscription work in an unfamiliar environment.",
          "Use profile vcfaBuiltIns when the snapshot should focus on VMware baseline content: workflows in subfolders below Library and actions in com.vmware modules.",
          "Use vcfa-discover-capabilities for exploratory conversational discovery; use collect-context-snapshot when the inventory should be persisted for future agents.",
          "Persist both Markdown and JSON so humans and agents can reuse the same snapshot before rediscovering assets.",
          ...discoveryGuardrails(),
          "Do not ask the user to provide workflow, action, parameter, category, project, or template details that can be discovered by the snapshot tool.",
          "After the snapshot is written, summarize the saved paths, collected counts, skipped counts, and any warnings.",
        ]),
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
        buildPromptText([
          `Action hint: ${actionHint}`,
          `Workflow goal: ${workflowGoal}`,
          categoryHint ? `Category hint: ${categoryHint}` : undefined,
          "",
          "Read vcfa://patterns/workflows/action-wrapper and vcfa://schemas/workflow-scaffold.",
          "Use list-actions with a focused filter, then get-action on the exact match to verify module, name, inputs, return type, and script behavior.",
          "Use list-categories for WorkflowCategory if the category is not already known.",
          ...discoveryGuardrails(),
          "For a single-action wrapper, prefer a native vRO action workflow item in a horizontally arranged workflow. Use scaffold-workflow-file only when a scriptable task is appropriate, such as multiple action calls or additional orchestration logic. Publish reusable wrappers through the project package path.",
        ]),
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
        buildPromptText([
          `Workflow hint: ${workflowHint}`,
          `Refactor goal: ${refactorGoal}`,
          "",
          "Use list-workflows and get-workflow to identify and inspect the existing workflow contract before proposing edits.",
          "Export the current workflow with export-workflow-file before preparing replacement artifacts.",
          "Read vcfa://docs/artifact-authoring and vcfa://patterns/workflows/basic-scriptable-task for scaffold and validation constraints.",
          ...discoveryGuardrails(),
          "Use preflight-workflow-file and diff-workflow-file before recommending import. Do not import until the user confirms target, overwrite intent, and risk; include expectedCategoryId or expectedCategoryName in the confirmed import call when available.",
        ]),
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
        buildPromptText([
          `Template goal: ${templateGoal}`,
          projectHint ? `Project hint: ${projectHint}` : undefined,
          "",
          "Read vcfa://patterns/templates/conventions and vcfa://patterns/templates/small-vm or vcfa://patterns/templates/catalog-ready when relevant.",
          "Use list-templates and get-template to find reusable YAML conventions before drafting content.",
          "Use list-catalog-items or list-deployments when the template must align with catalog or deployment behavior.",
          ...discoveryGuardrails(),
          "Call create-template with confirm set to true only after the target projectId and YAML content are confirmed, then verify with get-template.",
        ]),
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
        buildPromptText([
          `Template ID: ${templateId}`,
          reviewGoal ? `Review focus: ${reviewGoal}` : undefined,
          "",
          "Use get-template to inspect metadata, validity, project, and YAML content.",
          "Compare against vcfa://patterns/templates/conventions and relevant template pattern resources.",
          "Use list-catalog-items or get-catalog-item when reviewing catalog-facing behavior.",
          ...discoveryGuardrails(),
          "Summarize concrete findings, missing facts, and any safe follow-up tool calls. Do not modify or delete templates during review.",
        ]),
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
        buildPromptText([
          `Integration goal: ${integrationGoal}`,
          workflowHint ? `Workflow hint: ${workflowHint}` : undefined,
          templateHint ? `Template hint: ${templateHint}` : undefined,
          "",
          "Use list-workflows/get-workflow, list-templates/get-template, list-catalog-items/get-catalog-item, list-event-topics, and list-subscriptions to map current state.",
          "Use list-deployments and list-deployment-actions if day-2 behavior matters.",
          ...discoveryGuardrails(),
          "Recommend create-subscription, update-subscription, template creation, or workflow import only as explicit next steps with required confirm arguments, expected target fields where supported, and risks.",
        ]),
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
        buildPromptText([
          `Goal: ${goal}`,
          artifactKinds ? `Artifact focus: ${artifactKinds}` : undefined,
          "",
          "Start with read-only discovery calls relevant to the artifact focus: list-workflows, list-workflows-by-category, list-actions, list-configurations, list-resource-elements, list-templates, list-catalog-items, list-deployments, list-event-topics, list-subscriptions, list-categories, list-packages, and list-plugins.",
          "Read relevant vcfa://docs, vcfa://schemas, and vcfa://patterns resources before recommending artifact creation.",
          ...discoveryGuardrails(),
          "Return a phased plan with discovery, local artifact generation, preflight/diff, expected target fields for confirmed mutations, confirmation points, import or create calls, and post-change verification.",
        ]),
      ),
  );

  server.registerPrompt(
    "vcfa-troubleshoot-workflow-execution",
    {
      title: "Troubleshoot Workflow Execution",
      description:
        "Diagnose a failed or problematic workflow execution using logs, stack, and workflow source.",
      argsSchema: {
        workflowHint: z
          .string()
          .describe("Workflow ID, name, or search hint"),
        executionId: z
          .string()
          .optional()
          .describe("Optional execution ID to inspect directly"),
      },
    },
    ({ workflowHint, executionId }) =>
      promptResult(
        "Troubleshoot a vRO workflow execution.",
        buildPromptText([
          `Workflow hint: ${workflowHint}`,
          executionId ? `Execution ID: ${executionId}` : undefined,
          "",
          "Use list-workflows to identify the workflow, then get-workflow to inspect its parameters and structure.",
          "Use list-workflow-executions to find recent runs, or inspect the provided execution ID directly with get-workflow-execution.",
          "Check execution state and stack trace. For failed or cancelled executions, identify the failing workflow item and current-item details.",
          "Use get-workflow-execution-logs with error level focus to surface error messages, then broaden to info or debug if needed.",
          "If the failure is in a scriptable task, use export-workflow-file to inspect the workflow source script at the reported line numbers.",
          ...discoveryGuardrails(),
          "Summarize the root cause, affected workflow item, relevant log entries, and suggest concrete fixes or next diagnostic steps.",
        ]),
      ),
  );
}
