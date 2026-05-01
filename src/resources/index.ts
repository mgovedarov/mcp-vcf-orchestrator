import { readFile } from "node:fs/promises";
import {
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { VroClient } from "../vro-client.js";

const README_URL = new URL("../../README.md", import.meta.url);
const ARTIFACT_AUTHORING_URL = new URL(
  "../../docs/vro-artifact-authoring.md",
  import.meta.url,
);

const WORKFLOW_SCAFFOLD_SCHEMA = {
  tool: "scaffold-workflow-file",
  purpose:
    "Generate a local importable .workflow artifact from structured workflow metadata and linear scriptable tasks.",
  fileSafety: {
    fileName:
      "Plain .workflow file name under the configured workflow artifact directory; no paths or traversal.",
    overwrite: "Defaults to false.",
  },
  workflow: {
    id: "Optional workflow UUID. Omit to generate one.",
    name: "Required workflow display name.",
    description: "Optional workflow description.",
    version: "Optional workflow version. Defaults to 1.0.0.",
    apiVersion: "Optional vRO workflow API version. Defaults to 6.0.0.",
    inputs: [
      {
        name: "Required script-safe parameter name.",
        type: "Required vRO parameter type, for example string or Array/Properties.",
        description: "Optional parameter description.",
      },
    ],
    outputs: [
      {
        name: "Required script-safe parameter name.",
        type: "Required vRO parameter type.",
        description: "Optional parameter description.",
      },
    ],
    attributes: [
      {
        name: "Required script-safe workflow attribute name.",
        type: "Required vRO parameter type.",
        description: "Optional attribute description.",
      },
    ],
    tasks: [
      {
        name: "Optional internal workflow item name. Defaults to itemN.",
        displayName: "Optional visible task name.",
        description: "Optional task description.",
        script: "Required vRO JavaScript scriptable task body.",
        inBindings: [
          {
            name: "Script variable name.",
            type: "Must match the source input or attribute type.",
            source: "Workflow input or attribute name.",
          },
        ],
        outBindings: [
          {
            name: "Script variable name.",
            type: "Must match the target output or attribute type.",
            target: "Workflow output or attribute name.",
          },
        ],
      },
    ],
  },
  validation:
    "The scaffold validates required names, script identifier names, duplicate workflow parameter names, task presence, binding references, and binding type matches.",
  nextSteps: [
    "Run preflight-workflow-file on the generated artifact.",
    "Run diff-workflow-file when replacing an existing workflow.",
    "Import only after preflight passes and the user confirms the target category and overwrite intent.",
  ],
};

const TEMPLATE_CONVENTIONS = `# Template Metadata And Content Conventions

Use \`list-templates\` to discover existing Cloud Assembly blueprint templates before creating new ones. Use \`get-template\` to inspect full metadata and YAML content for candidate templates.

Template metadata handled by the current tools includes:

- \`id\`, \`name\`, \`description\`, \`status\`, \`projectId\`, \`projectName\`, \`valid\`, \`createdBy\`, \`createdAt\`, \`updatedBy\`, and \`updatedAt\` when returned by the API.
- \`create-template\` accepts \`name\`, \`projectId\`, optional \`description\`, optional YAML \`content\`, and optional \`requestScopeOrg\`.

Authoring rules:

- Treat YAML content as Cloud Assembly blueprint content; do not invent provider-specific properties unless they were discovered from existing templates, catalog items, docs, or user input.
- Prefer adapting a discovered template over creating a duplicate from memory.
- If discovery returns no suitable template or project, stop and report the gap instead of guessing IDs, resource types, or inputs.
- After creating a template, verify with \`list-templates\` or \`get-template\`.
`;

const WORKFLOW_BASIC_SCRIPTABLE_TASK_PATTERN = `# Workflow Pattern: basic-scriptable-task

Use this pattern when one workflow can be represented as a linear scriptable task with explicit inputs and outputs.

Discovery first:

- Run \`list-categories\` for \`WorkflowCategory\` when the target category is unknown.
- Run \`list-workflows\` for similar workflows and \`list-actions\` for reusable logic before writing a new script.
- If a required action, workflow, category, or parameter cannot be found, stop and surface the missing dependency.

Implementation shape:

- Declare workflow inputs, outputs, and attributes explicitly in \`scaffold-workflow-file\`.
- Bind every script variable through \`inBindings\` or \`outBindings\`; binding types must match the referenced workflow parameter or attribute.
- Keep the script readable because vRO runtime errors often point to item line numbers.
- Validate required inputs early and fail with clear messages.

Validation flow:

1. \`scaffold-workflow-file\`
2. \`preflight-workflow-file\`
3. \`diff-workflow-file\` when replacing an existing workflow
4. \`import-workflow-file\` only after preflight passes and the user confirms category and overwrite intent
`;

const WORKFLOW_ACTION_WRAPPER_PATTERN = `# Workflow Pattern: action-wrapper

Use this pattern when a workflow should expose an existing vRO action through workflow inputs and outputs.

Discovery first:

- Run \`list-actions\` with a focused filter, then \`get-action\` for the exact action ID or fully qualified name.
- Confirm the action module, name, input parameters, return type, and script behavior before authoring the wrapper.
- If the action is not found or discovery returns partial data, stop and ask for the missing action details. Do not invent parameter names or return types.

Implementation shape:

- Mirror action inputs as workflow inputs unless the user asks for a different public contract.
- Use action parameter names and types exactly as discovered.
- Call the action through \`System.getModule("<module>").<actionName>(...)\` only after the module and action name were verified.
- Bind the action result to a workflow output with the discovered return type.

Validation flow:

- Preflight the workflow artifact and review action references before import.
- After import, use \`get-workflow\` to verify the wrapper contract before running it.
`;

const TEMPLATE_SMALL_VM_PATTERN = `# Template Pattern: small-vm

Use this pattern to draft a small VM blueprint template only after discovering the environment-specific resource types and project.

Discovery first:

- Run \`list-templates\` for existing small VM, Linux, Windows, or project-specific templates.
- Run \`get-template\` on the closest match and reuse its resource type names, image/flavor conventions, networks, constraints, and inputs when appropriate.
- Confirm the target \`projectId\`; do not guess project IDs.

Implementation shape:

- Keep the first draft minimal: one machine resource, explicit user-facing inputs only when needed, and a short description.
- Prefer values and property names already present in discovered templates.
- If no reliable template or user-provided schema exists, return a proposed plan and the missing facts instead of creating YAML from memory.

Validation flow:

- Use \`create-template\` only after the target project and YAML content are confirmed.
- Verify the result with \`get-template\` and inspect \`valid\` or status fields when returned.
`;

const TEMPLATE_CATALOG_READY_PATTERN = `# Template Pattern: catalog-ready

Use this pattern when a template is intended to become a Service Broker catalog item or support deployment workflows.

Discovery first:

- Inspect existing templates with \`list-templates\` and \`get-template\`.
- Inspect related catalog items with \`list-catalog-items\` and \`get-catalog-item\`.
- Inspect relevant deployments with \`list-deployments\` when matching an existing lifecycle.
- If required catalog, project, or template details are absent, stop and report what must be confirmed.

Implementation shape:

- Keep template inputs stable and clearly named because catalog requests depend on them.
- Align defaults, descriptions, and constraints with discovered catalog items or templates.
- Avoid destructive day-2 assumptions; use deployment tools to discover available actions.

Validation flow:

- Create or update templates only with confirmed project and content.
- After catalog publication outside this toolset, use catalog and deployment tools to verify request shape before creating deployments.
`;

function textResource(
  uri: string,
  mimeType: string,
  text: string,
): ReadResourceResult {
  return {
    contents: [{ uri, mimeType, text }],
  };
}

function jsonResource(uri: string, value: unknown): ReadResourceResult {
  return textResource(uri, "application/json", JSON.stringify(value, null, 2));
}

async function markdownFileResource(
  uri: URL,
  fileUrl: URL,
): Promise<ReadResourceResult> {
  const text = await readFile(fileUrl, "utf8");
  return textResource(uri.href, "text/markdown", text);
}

function singleVariable(
  variables: Record<string, string | string[]>,
  name: string,
): string {
  const value = variables[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function registerVcfaResources(
  server: McpServer,
  client: VroClient,
): void {
  server.registerResource(
    "vcfa-docs-artifact-authoring",
    "vcfa://docs/artifact-authoring",
    {
      title: "vRO Artifact Authoring Guide",
      description:
        "Repository guidance for authoring, validating, importing, and exporting vRO artifacts.",
      mimeType: "text/markdown",
    },
    (uri) => markdownFileResource(uri, ARTIFACT_AUTHORING_URL),
  );

  server.registerResource(
    "vcfa-docs-readme",
    "vcfa://docs/readme",
    {
      title: "VCFA MCP Server README",
      description:
        "Top-level README for available VCFA MCP server tools, examples, and configuration.",
      mimeType: "text/markdown",
    },
    (uri) => markdownFileResource(uri, README_URL),
  );

  server.registerResource(
    "vcfa-schema-workflow-scaffold",
    "vcfa://schemas/workflow-scaffold",
    {
      title: "Workflow Scaffold Schema",
      description:
        "Structured input contract and validation notes for scaffold-workflow-file.",
      mimeType: "application/json",
    },
    (uri) => jsonResource(uri.href, WORKFLOW_SCAFFOLD_SCHEMA),
  );

  server.registerResource(
    "vcfa-template-conventions",
    "vcfa://patterns/templates/conventions",
    {
      title: "Template Metadata And Content Conventions",
      description:
        "Cloud Assembly template fields and discovery-first authoring rules supported by the current tools.",
      mimeType: "text/markdown",
    },
    (uri) => textResource(uri.href, "text/markdown", TEMPLATE_CONVENTIONS),
  );

  server.registerResource(
    "vcfa-pattern-workflow-basic-scriptable-task",
    "vcfa://patterns/workflows/basic-scriptable-task",
    {
      title: "Workflow Pattern: basic-scriptable-task",
      description:
        "Discovery, scaffold, binding, and validation guidance for a linear scriptable-task workflow.",
      mimeType: "text/markdown",
    },
    (uri) =>
      textResource(uri.href, "text/markdown", WORKFLOW_BASIC_SCRIPTABLE_TASK_PATTERN),
  );

  server.registerResource(
    "vcfa-pattern-workflow-action-wrapper",
    "vcfa://patterns/workflows/action-wrapper",
    {
      title: "Workflow Pattern: action-wrapper",
      description:
        "Discovery and implementation guidance for wrapping an existing vRO action in a workflow.",
      mimeType: "text/markdown",
    },
    (uri) =>
      textResource(uri.href, "text/markdown", WORKFLOW_ACTION_WRAPPER_PATTERN),
  );

  server.registerResource(
    "vcfa-pattern-template-small-vm",
    "vcfa://patterns/templates/small-vm",
    {
      title: "Template Pattern: small-vm",
      description:
        "Discovery-first guidance for drafting a minimal small VM blueprint template.",
      mimeType: "text/markdown",
    },
    (uri) => textResource(uri.href, "text/markdown", TEMPLATE_SMALL_VM_PATTERN),
  );

  server.registerResource(
    "vcfa-pattern-template-catalog-ready",
    "vcfa://patterns/templates/catalog-ready",
    {
      title: "Template Pattern: catalog-ready",
      description:
        "Guidance for templates intended to support catalog and deployment workflows.",
      mimeType: "text/markdown",
    },
    (uri) =>
      textResource(uri.href, "text/markdown", TEMPLATE_CATALOG_READY_PATTERN),
  );

  server.registerResource(
    "vcfa-workflow",
    new ResourceTemplate("vcfa://workflows/{id}", { list: undefined }),
    {
      title: "VCFA Workflow",
      description: "Read a workflow definition by workflow ID.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      jsonResource(
        uri.href,
        await client.getWorkflow(singleVariable(variables, "id")),
      ),
  );

  server.registerResource(
    "vcfa-action",
    new ResourceTemplate("vcfa://actions/{id}", { list: undefined }),
    {
      title: "VCFA Action",
      description: "Read an action definition by action ID or fully qualified name.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      jsonResource(
        uri.href,
        await client.getAction(singleVariable(variables, "id")),
      ),
  );

  server.registerResource(
    "vcfa-deployment",
    new ResourceTemplate("vcfa://deployments/{id}", { list: undefined }),
    {
      title: "VCFA Deployment",
      description: "Read a deployment by deployment ID.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      jsonResource(
        uri.href,
        await client.getDeployment(singleVariable(variables, "id")),
      ),
  );

  server.registerResource(
    "vcfa-package",
    new ResourceTemplate("vcfa://packages/{name}", { list: undefined }),
    {
      title: "vRO Package",
      description: "Read package metadata by fully qualified package name.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      jsonResource(
        uri.href,
        await client.getPackage(singleVariable(variables, "name")),
      ),
  );
}
