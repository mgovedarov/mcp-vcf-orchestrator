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
  script: string;
  inBindings: WorkflowArtifactBinding[];
  outBindings: WorkflowArtifactBinding[];
  /** `<module>/<actionName>` for native action items; empty for scriptable tasks. */
  scriptModule: string;
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

interface InputFormType {
  dataType: string;
  referenceType?: string;
  itemType?: InputFormType;
}

export function buildWorkflowArtifact(spec: WorkflowArtifactSpec): Uint8Array {
  const normalized = normalizeWorkflowArtifactSpec(spec);
  return zipSync({
    "workflow-info": utf8Bytes(buildWorkflowInfo(normalized)),
    "workflow-content": utf16LeWithBom(renderWorkflowContentXml(normalized)),
    "input_form_": utf16BeWithBom(renderWorkflowInputFormJson(normalized)),
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

export function buildWorkflowInputForm(spec: WorkflowArtifactSpec): Uint8Array {
  return utf16BeWithBom(
    renderWorkflowInputFormJson(normalizeWorkflowArtifactSpec(spec)),
  );
}

export function buildWorkflowInputFormJson(spec: WorkflowArtifactSpec): string {
  return renderWorkflowInputFormJson(normalizeWorkflowArtifactSpec(spec));
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

    const normalizedCore = {
      name: taskName,
      displayName: nonEmpty(task.displayName) ?? taskName,
      description: task.description ?? "",
    };

    if ((task.kind ?? "script") === "action") {
      return normalizeActionTask(task, normalizedCore, {
        inputOrAttributeTypes,
        outputOrAttributeTypes,
        errors,
      });
    }

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
      ...normalizedCore,
      script,
      inBindings,
      outBindings,
      scriptModule: "",
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

function normalizeActionTask(
  task: WorkflowArtifactTask,
  core: { name: string; displayName: string; description: string },
  ctx: {
    inputOrAttributeTypes: Map<string, string>;
    outputOrAttributeTypes: Map<string, string>;
    errors: string[];
  },
): NormalizedWorkflowArtifactTask {
  const { name: taskName } = core;
  const { errors } = ctx;
  const module = nonEmpty(task.module);
  const actionName = nonEmpty(task.actionName);
  if (!module) {
    errors.push(`Action task ${taskName} is missing a module`);
  }
  if (!actionName) {
    errors.push(`Action task ${taskName} is missing an actionName`);
  }

  const actionInputs = task.inputs ?? [];
  const inBindings = normalizeBindings(
    actionInputs.map((input) => ({
      name: input.name,
      type: input.type,
      source: input.source,
    })),
    "input",
    taskName,
    ctx.inputOrAttributeTypes,
    errors,
  );

  const resultBinding = task.resultBinding;
  const outBindings = resultBinding
    ? normalizeBindings(
        [
          {
            name: "actionResult",
            type: resultBinding.type,
            target: resultBinding.name,
          },
        ],
        "output",
        taskName,
        ctx.outputOrAttributeTypes,
        errors,
      )
    : [];

  const callArgs = inBindings.map((binding) => binding.name).join(", ");
  const invocation = `System.getModule("${module ?? ""}").${actionName ?? ""}(${callArgs});`;
  const script = resultBinding ? `actionResult = ${invocation}` : invocation;

  return {
    ...task,
    ...core,
    script,
    inBindings,
    outBindings,
    scriptModule: module && actionName ? `${module}/${actionName}` : "",
  };
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
    renderPresentation(spec.inputs),
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
  const scriptModuleAttr = task.scriptModule
    ? ` script-module="${escapeXmlAttribute(task.scriptModule)}"`
    : "";
  return [
    `  <workflow-item name="${escapeXmlAttribute(task.name)}" type="task"${scriptModuleAttr}${flowAttrs}>`,
    `    <display-name>${cdata(task.displayName)}</display-name>`,
    `    <description>${cdata(task.description)}</description>`,
    renderBindings("in-binding", task.inBindings, "source"),
    renderBindings("out-binding", task.outBindings, "target"),
    `    <script encoded="false">${cdata(task.script)}</script>`,
    "  </workflow-item>",
  ].join("\n");
}

function renderPresentation(inputs: WorkflowArtifactParameter[]): string {
  if (inputs.length === 0) {
    return "  <presentation />";
  }

  return [
    "  <presentation>",
    "    <p-step>",
    "      <title><![CDATA[General]]></title>",
    "      <p-group>",
    "        <title><![CDATA[Inputs]]></title>",
    ...inputs.map(
      (input) =>
        `        <p-param name="${escapeXmlAttribute(input.name)}"><desc>${cdata(input.description ?? input.name)}</desc></p-param>`,
    ),
    "      </p-group>",
    "    </p-step>",
    "  </presentation>",
  ].join("\n");
}

function renderWorkflowInputFormJson(spec: NormalizedSpec): string {
  const schema = Object.fromEntries(
    spec.inputs.map((input) => [
      input.name,
      {
        id: input.name,
        type: inputFormType(input.type),
        label: input.description || input.name,
        constraints: { required: true },
      },
    ]),
  );

  const pages = spec.inputs.length === 0
    ? []
    : [
        {
          id: "page_general",
          sections: [
            {
              id: "section_inputs",
              fields: spec.inputs.map((input) => ({
                id: input.name,
                display: inputFormDisplay(input.type),
                signpostPosition: "right-middle",
                state: { visible: true, "read-only": false },
              })),
            },
          ],
          title: "General",
        },
      ];

  return `${JSON.stringify({
    layout: { pages },
    schema,
    options: { externalValidations: [] },
    itemId: "",
  })}\n`;
}

function inputFormType(type: string): InputFormType {
  const arrayItemType = type.match(/^Array\/(.+)$/)?.[1];
  if (arrayItemType) {
    return { dataType: "array", itemType: inputFormType(arrayItemType) };
  }

  if (type.includes(":")) {
    return { dataType: "reference", referenceType: type };
  }

  switch (type) {
    case "boolean":
      return { dataType: "boolean" };
    case "number":
      return { dataType: "decimal" };
    case "SecureString":
      return { dataType: "secureString" };
    case "string":
    default:
      return { dataType: "string" };
  }
}

function inputFormDisplay(type: string): string {
  if (type.startsWith("Array/")) return "multiValuePicker";
  if (type.includes(":")) return "valuePickerTree";

  switch (type) {
    case "boolean":
      return "checkbox";
    case "number":
      return "decimalField";
    case "SecureString":
      return "passwordField";
    case "string":
    default:
      return "textField";
  }
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

function utf16BeWithBom(value: string): Uint8Array {
  const littleEndian = Buffer.from(value, "utf16le");
  for (let index = 0; index < littleEndian.length; index += 2) {
    const first = littleEndian[index];
    littleEndian[index] = littleEndian[index + 1] ?? 0;
    littleEndian[index + 1] = first;
  }
  return new Uint8Array([0xfe, 0xff, ...littleEndian]);
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
