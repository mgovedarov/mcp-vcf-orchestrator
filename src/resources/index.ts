import { readdir, readFile, stat } from "node:fs/promises";
import {
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ListResourcesResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { basename, extname } from "node:path";
import { resolveEffectiveContextDirectory } from "../context-directory.js";
import { getExistingFile, rejectSymlink, resolveFileInDirectory } from "../client/files.js";
import type { VroClient } from "../vro-client.js";

const README_URL = new URL("../../README.md", import.meta.url);
const ARTIFACT_AUTHORING_URL = new URL(
  "../../docs/vro-artifact-authoring.md",
  import.meta.url,
);

const WORKFLOW_SCAFFOLD_SCHEMA = {
  tool: "scaffold-workflow-file",
  purpose:
    "Generate a local importable .workflow artifact from structured workflow metadata and linear tasks.",
  scope:
    'Each task is either a native vRO action workflow item (kind "action") or a scriptable task (kind "script", the default). When a workflow step only invokes one existing vRO action, use kind "action" with the discovered module/actionName so the scaffold emits a native action workflow item directly. Use kind "script" when the step needs custom logic, multiple action calls, or additional orchestration.',
  layout:
    "Prefer horizontal workflow layouts. Place sequential workflow items left-to-right by increasing x positions while keeping y positions stable unless a branch needs vertical separation.",
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
        kind: 'Optional task kind. "script" (default) renders a scriptable task; "action" renders a native vRO action workflow item.',
        script:
          'Required vRO JavaScript scriptable task body for kind "script". Ignored for kind "action" (generated automatically).',
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
        module:
          'Native action module name for kind "action", e.g. com.example.actions. Discover with get-action; do not invent.',
        actionName:
          'Native action name for kind "action". Discover with get-action; do not invent.',
        inputs: [
          {
            name: "Action input parameter name in action signature order.",
            type: "Must match the source input or attribute type.",
            source: "Workflow input or attribute name to pass in.",
          },
        ],
        resultBinding: {
          name: "Workflow output or attribute that receives the action result (actionResult). Omit for actions with no return value.",
          type: "Must match the target output or attribute type.",
        },
      },
    ],
  },
  validation:
    'The scaffold validates required names, script identifier names, duplicate workflow parameter names, task presence, binding references, and binding type matches. For kind "action" it requires module and actionName and binds actionResult to the resultBinding target.',
  nextSteps: [
    "Run preflight-workflow-file on the generated artifact.",
    "Run diff-workflow-file when replacing an existing workflow.",
    "Import only after preflight passes and the user confirms the target category and overwrite intent.",
  ],
};

const TEMPLATE_CONVENTIONS = `# Template Metadata And Content Conventions

Use \`list-templates\` to discover existing Cloud Assembly blueprint templates before creating new ones. Use \`get-template\` to inspect full metadata; set \`includeContent: true\` to read the YAML content for candidate templates.

Template metadata handled by the current tools includes:

- \`id\`, \`name\`, \`description\`, \`status\`, \`projectId\`, \`projectName\`, \`valid\`, \`createdBy\`, \`createdAt\`, \`updatedBy\`, and \`updatedAt\` when returned by the API.
- \`create-template\` accepts \`name\`, \`projectId\`, optional \`description\`, optional YAML \`content\`, optional \`requestScopeOrg\`, and required \`confirm: true\`.

Authoring rules:

- Treat YAML content as Cloud Assembly blueprint content; do not invent provider-specific properties unless they were discovered from existing templates, catalog items, docs, or user input.
- Prefer adapting a discovered template over creating a duplicate from memory.
- If discovery returns no suitable template or project, stop and report the gap instead of guessing IDs, resource types, or inputs.
- After creating a template, verify with \`list-templates\` or \`get-template\`.
`;

const WORKFLOW_BASIC_SCRIPTABLE_TASK_PATTERN = `# Workflow Pattern: basic-scriptable-task

Use this pattern when one workflow can be represented as a linear scriptable task with explicit inputs and outputs.

Prefer native action workflow items when the workflow only invokes one existing vRO action. Use a scriptable task for custom JavaScript logic, input shaping, branching, or when one item performs more than one action call.

Discovery first:

- Run \`list-categories\` for \`WorkflowCategory\` when the target category is unknown.
- Run \`list-workflows\` for similar workflows and \`list-actions\` for reusable logic before writing a new script.
- If a required action, workflow, category, or parameter cannot be found, stop and surface the missing dependency.

Implementation shape:

- Declare workflow inputs, outputs, and attributes explicitly in \`scaffold-workflow-file\`.
- Bind every script variable through \`inBindings\` or \`outBindings\`; binding types must match the referenced workflow parameter or attribute.
- The scaffold emits a vRO-compatible \`input_form_\` for declared inputs. It uses UTF-16BE JSON with a BOM, page-level titles, section objects with only \`id\` and \`fields\`, field IDs that match schema keys, and \`options.externalValidations: []\`.
- Keep the script readable because vRO runtime errors often point to item line numbers.
- Use a horizontal layout when editing workflow XML directly: sequence items left-to-right with increasing x coordinates and a stable y coordinate.
- Validate required inputs early and fail with clear messages.

Validation flow:

1. \`scaffold-workflow-file\`
2. \`preflight-workflow-file\`
3. \`diff-workflow-file\` when replacing an existing workflow
4. For reusable project content, publish via the project package: \`ensure-project-package\`, \`add-workflow-to-project-package\`, \`rebuild-project-package\`, \`export-project-package\`, \`get-project-package-import-details\`, \`import-project-package\`
5. Use direct \`import-workflow-file\` only for narrow validation or explicitly requested one-off tests after preflight passes and the user confirms category and overwrite intent
`;

const WORKFLOW_ACTION_WRAPPER_PATTERN = `# Workflow Pattern: action-wrapper

Use this pattern when a workflow should expose an existing vRO action through workflow inputs and outputs.

Discovery first:

- Run \`list-actions\` with a focused filter, then \`get-action\` (with \`includeScript: true\` when the script matters) for the exact action ID or fully qualified name.
- Confirm the action module, name, input parameters, return type, and script behavior before authoring the wrapper.
- If the action is not found or discovery returns partial data, stop and ask for the missing action details. Do not invent parameter names or return types.

Implementation shape:

- Mirror action inputs as workflow inputs unless the user asks for a different public contract.
- Use action parameter names and types exactly as discovered.
- Prefer a native vRO action workflow item for a single action call. Do not wrap a single action in a scriptable task just to call \`System.getModule("<module>").<actionName>(...)\`.
- Use a scriptable task only when the workflow item performs multiple action calls or additional orchestration logic beyond a single action invocation.
- Scaffold the native action item directly: call \`scaffold-workflow-file\` with a task of \`kind: "action"\`, setting \`module\`, \`actionName\`, ordered \`inputs\` (mapped from workflow inputs/attributes), and \`resultBinding\` (the workflow output that receives the result). Omit \`resultBinding\` for an action with no return value.
- The scaffold emits the exported native action shape automatically: \`<workflow-item type="task" script-module="<module>/<actionName>">\` with a generated \`<script>\` that assigns the return value to \`actionResult\` (for example \`actionResult = System.getModule("<module>").<actionName>(...);\`) and an \`out-binding\` from \`actionResult\` to the workflow output.
- Bind the action result to a workflow output with the discovered return type via \`resultBinding\`.
- Prefer horizontal workflow layout when authoring or editing XML/package content: start on the left, place the action item to the right of the start/root item, and place the end item further right.
- Preserve or generate a valid \`input_form_\` when the wrapper has workflow inputs so it can be started from the vRO UI (the scaffold generates this automatically).

Validation flow:

- Preflight the workflow artifact and review action references before import.
- After import, use \`get-workflow\` to verify the wrapper contract before running it.
`;

const TEMPLATE_SMALL_VM_PATTERN = `# Template Pattern: small-vm

Use this pattern to draft a small VM blueprint template only after discovering the environment-specific resource types and project.

Discovery first:

- Run \`list-templates\` for existing small VM, Linux, Windows, or project-specific templates.
- Run \`get-template\` (with \`includeContent: true\`) on the closest match and reuse its resource type names, image/flavor conventions, networks, constraints, and inputs when appropriate.
- Confirm the target \`projectId\`; do not guess project IDs.

Implementation shape:

- Keep the first draft minimal: one machine resource, explicit user-facing inputs only when needed, and a short description.
- Prefer values and property names already present in discovered templates.
- If no reliable template or user-provided schema exists, return a proposed plan and the missing facts instead of creating YAML from memory.

Validation flow:

- Use \`create-template\` only after the target project and YAML content are confirmed, then pass \`confirm: true\`.
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

const SUBSCRIPTION_EVENT_DRIVEN_PATTERN = `# Subscription Pattern: event-driven

Use this pattern when creating extensibility subscriptions that wire VCF Automation event topics to vRO workflows.

Discovery first:

- Run \`list-event-topics\` to discover available event topics and their IDs before creating subscriptions.
- Run \`list-subscriptions\` and \`get-subscription\` (with \`includeConstraints: true\`) to inspect existing subscriptions for naming conventions, event filters, and workflow bindings.
- Run \`list-workflows\` and \`get-workflow\` to verify the target workflow exists, has the expected inputs, and can accept event payload data.
- If a required event topic, workflow, or project cannot be found, stop and report the gap.

Implementation shape:

- Use a descriptive subscription name that reflects the event topic and intended behavior.
- Set the event topic ID from the discovered list; do not guess topic IDs.
- Wire the subscription to a verified workflow ID. Confirm the workflow accepts the payload shape the event topic provides.
- Use event filters or conditions to narrow the trigger scope when appropriate. Prefer specific filters over catch-all subscriptions.
- Consider whether the subscription should be created in a disabled state for testing before enabling it in production.

Safety considerations:

- Creating or enabling a subscription is a live environment change that triggers on real events.
- During development, prefer creating subscriptions in a disabled state and enabling only after verification.
- Updating or disabling a subscription is often safer than deleting it during iterative testing.
- Confirm the subscription name, event topic, workflow target, and enabled state with the user before creation.
- After creation, verify with \`list-subscriptions\` or \`get-subscription\`.
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

interface SnapshotFile {
  fileName: string;
  path: string;
  mimeType: string;
  mtimeMs: number;
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
    "vcfa-context-latest",
    "vcfa://context/latest",
    {
      title: "Latest VCFA Context Snapshot",
      description:
        "Manifest for the most recent persisted VCFA context snapshot pair.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(
        uri.href,
        await latestContextSnapshotManifest(server, client),
      ),
  );

  server.registerResource(
    "vcfa-context-snapshot",
    new ResourceTemplate("vcfa://context/snapshots/{fileName}", {
      list: async () => listContextSnapshotResources(server, client),
    }),
    {
      title: "VCFA Context Snapshot File",
      description:
        "Read a persisted VCFA context snapshot Markdown or JSON file.",
      mimeType: "text/plain",
    },
    async (uri, variables) =>
      readContextSnapshotResource(
        uri.href,
        await resolveEffectiveContextDirectory(server, client),
        singleVariable(variables, "fileName"),
      ),
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

  server.registerResource(
    "vcfa-configuration",
    new ResourceTemplate("vcfa://configurations/{id}", { list: undefined }),
    {
      title: "VCFA Configuration Element",
      description: "Read a configuration element by ID.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      jsonResource(
        uri.href,
        await client.getConfiguration(singleVariable(variables, "id")),
      ),
  );

  server.registerResource(
    "vcfa-resource-element",
    new ResourceTemplate("vcfa://resource-elements/{id}", { list: undefined }),
    {
      title: "VCFA Resource Element",
      description: "Read resource element metadata by ID.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      jsonResource(
        uri.href,
        await client.getResourceElement(singleVariable(variables, "id")),
      ),
  );

  server.registerResource(
    "vcfa-subscription",
    new ResourceTemplate("vcfa://subscriptions/{id}", { list: undefined }),
    {
      title: "VCFA Subscription",
      description: "Read an extensibility subscription by ID.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      jsonResource(
        uri.href,
        await client.getSubscription(singleVariable(variables, "id")),
      ),
  );

  server.registerResource(
    "vcfa-pattern-subscription-event-driven",
    "vcfa://patterns/subscriptions/event-driven",
    {
      title: "Subscription Pattern: event-driven",
      description:
        "Discovery-first guidance for creating extensibility subscriptions wired to vRO workflows.",
      mimeType: "text/markdown",
    },
    (uri) =>
      textResource(uri.href, "text/markdown", SUBSCRIPTION_EVENT_DRIVEN_PATTERN),
  );
}

async function listContextSnapshotResources(
  server: McpServer,
  client: VroClient,
): Promise<ListResourcesResult> {
  const contextDir = await resolveEffectiveContextDirectory(server, client);
  const files = await listSnapshotFiles(contextDir);
  return {
    resources: files.map((file) => ({
      uri: snapshotResourceUri(file.fileName),
      name: file.fileName,
      title: `VCFA Context Snapshot: ${file.fileName}`,
      description: `Persisted VCFA context snapshot at ${file.path}`,
      mimeType: file.mimeType,
    })),
  };
}

async function latestContextSnapshotManifest(
  server: McpServer,
  client: VroClient,
): Promise<Record<string, unknown>> {
  const contextDir = await resolveEffectiveContextDirectory(server, client);
  const files = await listSnapshotFiles(contextDir);
  const pairs = snapshotPairs(files);
  const latest = pairs.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  if (!latest) {
    return {
      available: false,
      contextDir,
      message: "No context snapshot pairs are available.",
    };
  }

  const json = await readSnapshotJson(latest.json.path);
  const warnings = Array.isArray(json?.warnings) ? json.warnings : undefined;
  return {
    available: true,
    contextDir,
    jsonPath: latest.json.path,
    markdownPath: latest.markdown.path,
    profile: stringField(json, "profile"),
    counts: recordField(json, "counts"),
    warningsCount: warnings?.length ?? 0,
    resourceUris: {
      latest: "vcfa://context/latest",
      json: snapshotResourceUri(latest.json.fileName),
      markdown: snapshotResourceUri(latest.markdown.fileName),
    },
  };
}

async function readContextSnapshotResource(
  uri: string,
  contextDir: string,
  fileName: string,
): Promise<ReadResourceResult> {
  validateSnapshotFileName(fileName);
  const filePath = await resolveFileInDirectory(
    contextDir,
    fileName,
    "Context snapshot resource",
    "the configured context directory",
  );
  const existing = await getExistingFile(filePath);
  if (!existing) {
    throw new Error(`Context snapshot resource was not found: ${fileName}`);
  }
  await rejectSymlink(
    filePath,
    "Context snapshot resource must not be a symbolic link",
  );
  return textResource(uri, snapshotMimeType(fileName), await readFile(filePath, "utf8"));
}

async function listSnapshotFiles(contextDir: string): Promise<SnapshotFile[]> {
  const entries = await readdir(contextDir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const files: SnapshotFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isSnapshotFileName(entry.name)) continue;
    const path = await resolveFileInDirectory(
      contextDir,
      entry.name,
      "Context snapshot resource",
      "the configured context directory",
    );
    const file = await stat(path);
    files.push({
      fileName: entry.name,
      path,
      mimeType: snapshotMimeType(entry.name),
      mtimeMs: file.mtimeMs,
    });
  }
  return files.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

function snapshotPairs(files: SnapshotFile[]): Array<{
  json: SnapshotFile;
  markdown: SnapshotFile;
  mtimeMs: number;
}> {
  const grouped = new Map<string, { json?: SnapshotFile; markdown?: SnapshotFile }>();
  for (const file of files) {
    const baseName = file.fileName.slice(0, -extname(file.fileName).length);
    const group = grouped.get(baseName) ?? {};
    if (file.fileName.endsWith(".json")) group.json = file;
    if (file.fileName.endsWith(".md")) group.markdown = file;
    grouped.set(baseName, group);
  }
  return [...grouped.values()]
    .filter(
      (group): group is { json: SnapshotFile; markdown: SnapshotFile } =>
        group.json !== undefined && group.markdown !== undefined,
    )
    .map((group) => ({
      ...group,
      mtimeMs: Math.max(group.json.mtimeMs, group.markdown.mtimeMs),
    }));
}

async function readSnapshotJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function validateSnapshotFileName(fileName: string): void {
  if (fileName !== basename(fileName)) {
    throw new Error("Context snapshot resource file name must not contain path separators");
  }
  if (!isSnapshotFileName(fileName)) {
    throw new Error("Context snapshot resource file name must end with .json or .md");
  }
}

function isSnapshotFileName(fileName: string): boolean {
  return fileName.endsWith(".json") || fileName.endsWith(".md");
}

function snapshotMimeType(fileName: string): string {
  return fileName.endsWith(".json") ? "application/json" : "text/markdown";
}

function snapshotResourceUri(fileName: string): string {
  return `vcfa://context/snapshots/${encodeURIComponent(fileName)}`;
}

function stringField(
  value: Record<string, unknown> | null,
  field: string,
): string | undefined {
  const item = value?.[field];
  return typeof item === "string" ? item : undefined;
}

function recordField(
  value: Record<string, unknown> | null,
  field: string,
): Record<string, unknown> | undefined {
  const item = value?.[field];
  return item && typeof item === "object" && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : undefined;
}
