import { zipSync } from "fflate";
import { randomUUID } from "node:crypto";
import type {
  WorkflowArtifactBinding,
  WorkflowArtifactParameter,
  WorkflowArtifactSpec,
  WorkflowArtifactTask,
} from "../types.js";

const DEFAULT_WORKFLOW_VERSION = "1.0.0";
const DEFAULT_WORKFLOW_API_VERSION = "6.0.0";
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

interface NormalizedWorkflowArtifactTask extends WorkflowArtifactTask {
  name: string;
  displayName: string;
  description: string;
  inBindings: WorkflowArtifactBinding[];
  outBindings: WorkflowArtifactBinding[];
}

interface NormalizedSpec {
  id: string;
  name: string;
  description: string;
  version: string;
  apiVersion: string;
  inputs: WorkflowArtifactParameter[];
  outputs: WorkflowArtifactParameter[];
  attributes: WorkflowArtifactParameter[];
  tasks: NormalizedWorkflowArtifactTask[];
}

export function buildWorkflowArtifact(spec: WorkflowArtifactSpec): Uint8Array {
  const normalized = normalizeWorkflowArtifactSpec(spec);
  return zipSync({
    "workflow-info": utf8Bytes(buildWorkflowInfo(normalized)),
    "workflow-content": utf16LeWithBom(renderWorkflowContentXml(normalized)),
  });
}

export function buildWorkflowContent(spec: WorkflowArtifactSpec): Uint8Array {
  return utf16LeWithBom(
    renderWorkflowContentXml(normalizeWorkflowArtifactSpec(spec)),
  );
}

export function buildWorkflowContentXml(spec: WorkflowArtifactSpec): string {
  return renderWorkflowContentXml(normalizeWorkflowArtifactSpec(spec));
}

export function buildWorkflowInfo(spec: WorkflowArtifactSpec): string {
  const normalized = normalizeWorkflowArtifactSpec(spec);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<workflow-info id="${escapeXmlAttribute(normalized.id)}" name="${escapeXmlAttribute(
      normalized.name,
    )}" version="${escapeXmlAttribute(normalized.version)}" />`,
    "",
  ].join("\n");
}

export function normalizeWorkflowArtifactSpec(
  spec: WorkflowArtifactSpec,
): NormalizedSpec {
  const errors: string[] = [];
  const id = nonEmpty(spec.id) ?? randomUUID();
  const name = nonEmpty(spec.name);
  if (!name) {
    errors.push("Workflow name is required");
  }

  const inputs = normalizeParameters(spec.inputs ?? [], "input", errors);
  const outputs = normalizeParameters(spec.outputs ?? [], "output", errors);
  const attributes = normalizeParameters(
    spec.attributes ?? [],
    "attribute",
    errors,
  );

  validateUniqueNames(
    "workflow parameter",
    [...inputs, ...outputs, ...attributes],
    errors,
  );

  const inputOrAttributeTypes = new Map<string, string>();
  for (const parameter of [...inputs, ...attributes]) {
    inputOrAttributeTypes.set(parameter.name, parameter.type);
  }

  const outputOrAttributeTypes = new Map<string, string>();
  for (const parameter of [...outputs, ...attributes]) {
    outputOrAttributeTypes.set(parameter.name, parameter.type);
  }

  if (!Array.isArray(spec.tasks) || spec.tasks.length === 0) {
    errors.push("At least one workflow task is required");
  }

  const taskNames = new Set<string>();
  const tasks = (spec.tasks ?? []).map((task, index) => {
    const taskName = nonEmpty(task.name) ?? `item${index + 1}`;
    if (taskNames.has(taskName)) {
      errors.push(`Duplicate task name: ${taskName}`);
    }
    taskNames.add(taskName);

    const script = task.script ?? "";
    if (!nonEmpty(script)) {
      errors.push(`Task ${taskName} script is required`);
    }

    const inBindings = normalizeBindings(
      task.inBindings ?? [],
      "input",
      taskName,
      inputOrAttributeTypes,
      errors,
    );
    const outBindings = normalizeBindings(
      task.outBindings ?? [],
      "output",
      taskName,
      outputOrAttributeTypes,
      errors,
    );

    return {
      ...task,
      name: taskName,
      displayName: nonEmpty(task.displayName) ?? taskName,
      description: task.description ?? "",
      script,
      inBindings,
      outBindings,
    };
  });

  if (errors.length > 0) {
    throw new Error(`Invalid workflow artifact spec:\n${errors.join("\n")}`);
  }

  return {
    id,
    name: name ?? "",
    description: spec.description ?? "",
    version: nonEmpty(spec.version) ?? DEFAULT_WORKFLOW_VERSION,
    apiVersion: nonEmpty(spec.apiVersion) ?? DEFAULT_WORKFLOW_API_VERSION,
    inputs,
    outputs,
    attributes,
    tasks,
  };
}

function normalizeParameters(
  parameters: WorkflowArtifactParameter[],
  label: string,
  errors: string[],
): WorkflowArtifactParameter[] {
  validateUniqueNames(label, parameters, errors);
  return parameters.map((parameter, index) => {
    const name = nonEmpty(parameter.name);
    const type = nonEmpty(parameter.type);
    if (!name) {
      errors.push(`${label} parameter at index ${index} is missing a name`);
    } else if (!IDENTIFIER_PATTERN.test(name)) {
      errors.push(
        `${label} parameter ${name} must be a valid script identifier`,
      );
    }
    if (!type) {
      errors.push(`${label} parameter ${name ?? index} is missing a type`);
    }
    return {
      name: name ?? "",
      type: type ?? "",
      description: parameter.description,
    };
  });
}

function normalizeBindings(
  bindings: WorkflowArtifactBinding[],
  direction: "input" | "output",
  taskName: string,
  availableTypes: Map<string, string>,
  errors: string[],
): NormalizedWorkflowArtifactTask["inBindings"] {
  return bindings.map((binding, index) => {
    const bindingName = nonEmpty(binding.name);
    const bindingType = nonEmpty(binding.type);
    const reference = nonEmpty(
      direction === "input" ? binding.source : binding.target,
    );
    const referenceLabel = direction === "input" ? "source" : "target";

    if (!bindingName) {
      errors.push(
        `${taskName} ${direction} binding at index ${index} is missing a name`,
      );
    } else if (!IDENTIFIER_PATTERN.test(bindingName)) {
      errors.push(
        `${taskName} ${direction} binding ${bindingName} must be a valid script identifier`,
      );
    }

    if (!bindingType) {
      errors.push(
        `${taskName} ${direction} binding ${bindingName ?? index} is missing a type`,
      );
    }

    if (!reference) {
      errors.push(
        `${taskName} ${direction} binding ${bindingName ?? index} is missing a ${referenceLabel}`,
      );
    } else {
      const declaredType = availableTypes.get(reference);
      if (!declaredType) {
        errors.push(
          `${taskName} ${direction} binding ${bindingName ?? index} references unknown ${referenceLabel} ${reference}`,
        );
      } else if (bindingType && declaredType !== bindingType) {
        errors.push(
          `${taskName} ${direction} binding ${bindingName ?? index} type ${bindingType} does not match ${reference} type ${declaredType}`,
        );
      }
    }

    return {
      ...binding,
      name: bindingName ?? "",
      type: bindingType ?? "",
      source: direction === "input" ? (reference ?? "") : binding.source,
      target: direction === "output" ? (reference ?? "") : binding.target,
    };
  });
}

function validateUniqueNames(
  label: string,
  values: { name?: string }[],
  errors: string[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const name = nonEmpty(value.name);
    if (!name) continue;
    if (seen.has(name)) {
      errors.push(`Duplicate ${label} name: ${name}`);
    }
    seen.add(name);
  }
}

function renderWorkflowContentXml(spec: NormalizedSpec): string {
  const rootTaskName = spec.tasks[0]?.name ?? "item1";
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    `<workflow xmlns="http://vmware.com/vco/workflow" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://vmware.com/vco/workflow http://vmware.com/vco/workflow/Workflow-v4.xsd" root-name="${escapeXmlAttribute(rootTaskName)}" object-name="workflow:name=generic" id="${escapeXmlAttribute(spec.id)}" version="${escapeXmlAttribute(spec.version)}" api-version="${escapeXmlAttribute(spec.apiVersion)}" restartMode="1" resumeFromFailedMode="0">`,
    `  <display-name>${cdata(spec.name)}</display-name>`,
    `  <description>${cdata(spec.description)}</description>`,
    renderParameterSection("input", spec.inputs),
    renderParameterSection("output", spec.outputs),
    renderAttributes(spec.attributes),
    ...spec.tasks.map((task, index) =>
      renderTask(task, spec.tasks[index + 1]?.name),
    ),
    "  <presentation />",
    "  <workflow-note />",
    "</workflow>",
    "",
  ].join("\n");
}

function renderParameterSection(
  elementName: "input" | "output",
  parameters: WorkflowArtifactParameter[],
): string {
  if (parameters.length === 0) {
    return `  <${elementName} />`;
  }

  return [
    `  <${elementName}>`,
    ...parameters.map(
      (parameter) =>
        `    <param name="${escapeXmlAttribute(parameter.name)}" type="${escapeXmlAttribute(parameter.type)}"><description>${cdata(parameter.description ?? "")}</description></param>`,
    ),
    `  </${elementName}>`,
  ].join("\n");
}

function renderAttributes(attributes: WorkflowArtifactParameter[]): string {
  if (attributes.length === 0) {
    return "  <attrib />";
  }

  return [
    "  <attrib>",
    ...attributes.map(
      (attribute) =>
        `    <param name="${escapeXmlAttribute(attribute.name)}" type="${escapeXmlAttribute(attribute.type)}" scope="local"><description>${cdata(attribute.description ?? "")}</description></param>`,
    ),
    "  </attrib>",
  ].join("\n");
}

function renderTask(
  task: NormalizedWorkflowArtifactTask,
  nextTaskName?: string,
): string {
  const flowAttrs = nextTaskName
    ? ` out-name="${escapeXmlAttribute(nextTaskName)}"`
    : ' end-mode="1"';
  return [
    `  <workflow-item name="${escapeXmlAttribute(task.name)}" type="task"${flowAttrs}>`,
    `    <display-name>${cdata(task.displayName)}</display-name>`,
    `    <description>${cdata(task.description)}</description>`,
    renderBindings("in-binding", task.inBindings, "source"),
    renderBindings("out-binding", task.outBindings, "target"),
    `    <script encoded="false">${cdata(task.script)}</script>`,
    "  </workflow-item>",
  ].join("\n");
}

function renderBindings(
  elementName: "in-binding" | "out-binding",
  bindings: WorkflowArtifactBinding[],
  referenceKey: "source" | "target",
): string {
  if (bindings.length === 0) {
    return `    <${elementName} />`;
  }

  return [
    `    <${elementName}>`,
    ...bindings.map((binding) => {
      const exportName =
        referenceKey === "source" ? binding.source : binding.target;
      return `      <bind name="${escapeXmlAttribute(binding.name)}" type="${escapeXmlAttribute(binding.type)}" export-name="${escapeXmlAttribute(exportName ?? "")}" />`;
    }),
    `    </${elementName}>`,
  ].join("\n");
}

function cdata(value: string): string {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function utf16LeWithBom(value: string): Uint8Array {
  return new Uint8Array([0xff, 0xfe, ...Buffer.from(value, "utf16le")]);
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
