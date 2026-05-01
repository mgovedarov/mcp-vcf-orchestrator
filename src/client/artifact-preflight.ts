import { unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { readFile } from "node:fs/promises";
import { extname, posix } from "node:path";
import {
  assertRealPathInside,
  rejectSymlink,
  resolveFileInDirectory,
} from "./files.js";

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const TYPE_PATTERN =
  /^(Array\/)?([A-Za-z_$][A-Za-z0-9_.$]*|[A-Za-z][A-Za-z0-9_]*:[A-Za-z_$][A-Za-z0-9_.$]*|void)$/;
const ACTION_REFERENCE_PATTERN =
  /System\.getModule\(\s*["']([^"']+)["']\s*\)\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true,
  cdataPropName: "#text",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
});

export type ArtifactKind =
  | "workflow"
  | "action"
  | "configuration"
  | "package";

export interface ArtifactPreflightEntry {
  name: string;
  size: number;
}

export interface ArtifactPreflightParameter {
  name: string;
  type: string;
  scope: string;
}

export interface ArtifactActionReference {
  module: string;
  action: string;
  expression: string;
}

export interface ArtifactPreflightReport {
  kind: ArtifactKind;
  fileName: string;
  filePath?: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  metadata: Record<string, string | number | boolean>;
  entries: ArtifactPreflightEntry[];
  parameters: ArtifactPreflightParameter[];
  actionReferences: ArtifactActionReference[];
}

type XmlObject = Record<string, unknown>;

interface WorkflowModel {
  root: XmlObject;
}

export async function preflightWorkflowFile(
  rootDir: string,
  fileName: string,
): Promise<ArtifactPreflightReport> {
  return preflightLocalArchive(rootDir, fileName, {
    kind: "workflow",
    label: "Workflow",
    envName: "VCFA_WORKFLOW_DIR",
    extensions: [".workflow"],
    validateArchive: validateWorkflowArchive,
  });
}

export async function preflightActionFile(
  rootDir: string,
  fileName: string,
): Promise<ArtifactPreflightReport> {
  return preflightLocalArchive(rootDir, fileName, {
    kind: "action",
    label: "Action",
    envName: "VCFA_ACTION_DIR",
    extensions: [".action"],
    validateArchive: validateGenericXmlArchive,
  });
}

export async function preflightConfigurationFile(
  rootDir: string,
  fileName: string,
): Promise<ArtifactPreflightReport> {
  return preflightLocalArchive(rootDir, fileName, {
    kind: "configuration",
    label: "Configuration",
    envName: "VCFA_CONFIGURATION_DIR",
    extensions: [".vsoconf"],
    validateArchive: validateGenericXmlArchive,
  });
}

export async function preflightPackageFile(
  rootDir: string,
  fileName: string,
): Promise<ArtifactPreflightReport> {
  return preflightLocalArchive(rootDir, fileName, {
    kind: "package",
    label: "Package",
    envName: "VCFA_PACKAGE_DIR",
    extensions: [".package", ".zip"],
    validateArchive: validatePackageArchive,
  });
}

export function ensurePreflightPassed(report: ArtifactPreflightReport): void {
  if (report.valid) return;
  throw new Error(formatPreflightFailure(report));
}

export function formatPreflightFailure(
  report: ArtifactPreflightReport,
): string {
  return [
    `${title(report.kind)} artifact preflight failed for ${report.fileName}.`,
    "",
    ...report.errors.map((error) => `• ${error}`),
  ].join("\n");
}

export function formatPreflightReport(report: ArtifactPreflightReport): string {
  const lines = [
    `${title(report.kind)} artifact preflight ${report.valid ? "passed" : "failed"} for ${report.fileName}.`,
  ];
  if (report.filePath) lines.push(`Path: ${report.filePath}`);
  lines.push(`Archive entries: ${report.entries.length}`);

  const metadata = Object.entries(report.metadata);
  if (metadata.length > 0) {
    lines.push("");
    lines.push("Metadata:");
    for (const [key, value] of metadata) {
      lines.push(`  • ${key}: ${String(value)}`);
    }
  }

  if (report.parameters.length > 0) {
    lines.push("");
    lines.push("Parameters:");
    for (const parameter of report.parameters) {
      lines.push(
        `  • ${parameter.name} (${parameter.type}) [${parameter.scope}]`,
      );
    }
  }

  if (report.actionReferences.length > 0) {
    lines.push("");
    lines.push("Action References:");
    for (const reference of report.actionReferences) {
      lines.push(`  • ${reference.module}/${reference.action}`);
    }
  }

  if (report.errors.length > 0) {
    lines.push("");
    lines.push("Errors:");
    lines.push(...report.errors.map((error) => `  • ${error}`));
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    lines.push(...report.warnings.map((warning) => `  • ${warning}`));
  }

  return lines.join("\n");
}

async function preflightLocalArchive(
  rootDir: string,
  fileName: string,
  options: {
    kind: ArtifactKind;
    label: string;
    envName: string;
    extensions: string[];
    validateArchive: (
      files: Record<string, Uint8Array>,
      report: ArtifactPreflightReport,
    ) => void;
  },
): Promise<ArtifactPreflightReport> {
  const report = newReport(options.kind, fileName);
  try {
    const ext = extname(fileName).toLowerCase();
    if (!options.extensions.includes(ext)) {
      throw new Error(
        `${options.label} file name must end with ${options.extensions.join(" or ")}`,
      );
    }

    const filePath = await resolveFileInDirectory(
      rootDir,
      fileName,
      options.label,
      options.envName,
    );
    report.filePath = filePath;
    await rejectSymlink(
      filePath,
      `${options.label} preflight source must not be a symbolic link`,
    );
    await assertRealPathInside(
      rootDir,
      filePath,
      `${options.label} file path resolves outside ${options.envName}`,
    );

    const buffer = new Uint8Array(await readFile(filePath));
    validateArchiveBuffer(buffer, report, options.validateArchive);
  } catch (error) {
    report.errors.push(errorMessage(error));
  }

  report.valid = report.errors.length === 0;
  return report;
}

function validateArchiveBuffer(
  buffer: Uint8Array,
  report: ArtifactPreflightReport,
  validateArchive: (
    files: Record<string, Uint8Array>,
    report: ArtifactPreflightReport,
  ) => void,
): void {
  if (buffer.byteLength === 0) {
    report.errors.push("Artifact file is empty");
    return;
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buffer);
  } catch (error) {
    report.errors.push(`Artifact is not a valid ZIP archive: ${errorMessage(error)}`);
    return;
  }

  for (const [name, content] of Object.entries(files)) {
    report.entries.push({ name, size: content.byteLength });
    validateZipEntryName(name, report);
  }

  if (report.entries.length === 0) {
    report.errors.push("Archive does not contain any entries");
    return;
  }

  validateArchive(files, report);
}

function validateWorkflowArchive(
  files: Record<string, Uint8Array>,
  report: ArtifactPreflightReport,
): void {
  const info = files["workflow-info"];
  const content = files["workflow-content"];
  if (!info) report.errors.push("Missing required workflow-info entry");
  if (!content) report.errors.push("Missing required workflow-content entry");
  if (!info || !content) return;

  const infoXml = decodeUtf8Xml(info, "workflow-info", report);
  if (infoXml) {
    const parsed = parseXml(infoXml, "workflow-info", report);
    const workflowInfo = getObject(parsed, "workflow-info");
    if (workflowInfo) {
      copyMetadata(workflowInfo, report, ["id", "name", "version"]);
    } else {
      report.errors.push("workflow-info does not contain a workflow-info root");
    }
  }

  const contentXml = decodeUtf16XmlWithBom(content, "workflow-content", report);
  if (!contentXml) return;

  const model = parseWorkflowContent(contentXml, report);
  if (!model) return;

  validateWorkflowModel(model, report);
}

function validateGenericXmlArchive(
  files: Record<string, Uint8Array>,
  report: ArtifactPreflightReport,
): void {
  let parsedXmlEntries = 0;
  for (const [name, content] of Object.entries(files)) {
    const xml = decodeLikelyXml(content);
    if (!xml) continue;

    const parsed = parseXml(xml, name, report);
    if (!parsed) continue;

    parsedXmlEntries += 1;
    collectGenericMetadata(parsed, report);
    collectGenericParameters(parsed, report);
    collectActionReferencesFromUnknown(parsed, report);
  }

  if (parsedXmlEntries === 0) {
    report.warnings.push(
      "No parseable XML entries were recognized; archive structure is not documented, so only ZIP/import safety was validated",
    );
  }
}

function validatePackageArchive(
  files: Record<string, Uint8Array>,
  report: ArtifactPreflightReport,
): void {
  let nestedArtifacts = 0;
  const counts = {
    workflows: 0,
    actions: 0,
    configurations: 0,
  };

  for (const [name, content] of Object.entries(files)) {
    const lowerName = name.toLowerCase();
    const nested = newReport(nestedKind(lowerName), name);
    if (lowerName.endsWith(".workflow")) {
      nestedArtifacts += 1;
      counts.workflows += 1;
      validateArchiveBuffer(content, nested, validateWorkflowArchive);
    } else if (lowerName.endsWith(".action")) {
      nestedArtifacts += 1;
      counts.actions += 1;
      validateArchiveBuffer(content, nested, validateGenericXmlArchive);
    } else if (lowerName.endsWith(".vsoconf")) {
      nestedArtifacts += 1;
      counts.configurations += 1;
      validateArchiveBuffer(content, nested, validateGenericXmlArchive);
    } else {
      continue;
    }

    report.parameters.push(...nested.parameters);
    report.actionReferences.push(...nested.actionReferences);
    report.errors.push(
      ...nested.errors.map((error) => `${name}: ${error}`),
    );
    report.warnings.push(
      ...nested.warnings.map((warning) => `${name}: ${warning}`),
    );
  }

  report.metadata.workflowArtifacts = counts.workflows;
  report.metadata.actionArtifacts = counts.actions;
  report.metadata.configurationArtifacts = counts.configurations;

  if (nestedArtifacts === 0) {
    report.warnings.push(
      "No nested .workflow, .action, or .vsoconf entries were recognized; only package ZIP/import safety was validated",
    );
  }
}

function parseWorkflowContent(
  xml: string,
  report: ArtifactPreflightReport,
): WorkflowModel | null {
  const parsed = parseXml(xml, "workflow-content", report);
  const root = getObject(parsed, "workflow");
  if (!root) {
    report.errors.push("workflow-content does not contain a workflow root");
    return null;
  }

  copyMetadata(root, report, [
    "id",
    "version",
    "api-version",
    "root-name",
    "object-name",
  ]);

  return { root };
}

function validateWorkflowModel(
  model: WorkflowModel,
  report: ArtifactPreflightReport,
): void {
  const rootName = stringValue(model.root["root-name"]);
  const inputs = collectWorkflowParams(model.root, "input");
  const outputs = collectWorkflowParams(model.root, "output");
  const attributes = collectWorkflowParams(model.root, "attrib");
  const inputOrAttributeTypes = new Map<string, string>();
  const outputOrAttributeTypes = new Map<string, string>();

  validateParameterList("input", inputs, report);
  validateParameterList("output", outputs, report);
  validateParameterList("attribute", attributes, report);
  validateUniqueParameters("workflow parameter", [
    ...inputs,
    ...outputs,
    ...attributes,
  ], report);

  for (const parameter of [...inputs, ...attributes]) {
    inputOrAttributeTypes.set(parameter.name, parameter.type);
  }
  for (const parameter of [...outputs, ...attributes]) {
    outputOrAttributeTypes.set(parameter.name, parameter.type);
  }

  report.parameters.push(...inputs, ...outputs, ...attributes);

  const items = getWorkflowItems(model.root);
  if (items.length === 0) {
    report.errors.push("workflow-content does not contain any workflow-item entries");
    return;
  }

  const itemNames = new Set<string>();
  for (const item of items) {
    const name = stringValue(item.name);
    if (!name) {
      report.errors.push("Workflow item is missing a name");
    } else if (itemNames.has(name)) {
      report.errors.push(`Duplicate workflow item name: ${name}`);
    } else {
      itemNames.add(name);
    }
  }

  if (rootName && !itemNames.has(rootName)) {
    report.errors.push(`Workflow root-name references unknown item ${rootName}`);
  }

  for (const item of items) {
    validateWorkflowItemFlow(item, itemNames, report);
    if (stringValue(item.type) === "task") {
      const script = getScriptText(item);
      if (!script.trim()) {
        report.errors.push(
          `Task ${stringValue(item.name) || "(unnamed)"} is missing script content`,
        );
      }
      collectActionReferences(script, report);
    }
    validateBindings(
      item,
      "in-binding",
      "source",
      inputOrAttributeTypes,
      report,
    );
    validateBindings(
      item,
      "out-binding",
      "target",
      outputOrAttributeTypes,
      report,
    );
  }
}

function validateWorkflowItemFlow(
  item: XmlObject,
  itemNames: Set<string>,
  report: ArtifactPreflightReport,
): void {
  const itemName = stringValue(item.name) || "(unnamed)";
  for (const attr of ["out-name", "alt-out-name", "catch-name"]) {
    const target = stringValue(item[attr]);
    if (target && !itemNames.has(target)) {
      report.errors.push(`${itemName} ${attr} references unknown item ${target}`);
    }
  }
}

function validateBindings(
  item: XmlObject,
  elementName: "in-binding" | "out-binding",
  referenceLabel: "source" | "target",
  availableTypes: Map<string, string>,
  report: ArtifactPreflightReport,
): void {
  const itemName = stringValue(item.name) || "(unnamed)";
  for (const binding of getBindings(item, elementName)) {
    const bindingName = stringValue(binding.name);
    const bindingType = stringValue(binding.type);
    const exportName = stringValue(binding["export-name"]);

    if (!bindingName) {
      report.errors.push(`${itemName} ${elementName} bind is missing a name`);
    } else if (!IDENTIFIER_PATTERN.test(bindingName)) {
      report.errors.push(
        `${itemName} ${elementName} bind ${bindingName} must be a valid script identifier`,
      );
    }

    if (!bindingType) {
      report.errors.push(
        `${itemName} ${elementName} bind ${bindingName || "(unnamed)"} is missing a type`,
      );
    } else {
      validateType(bindingType, `${itemName} ${elementName} bind ${bindingName}`, report);
    }

    if (!exportName) {
      report.errors.push(
        `${itemName} ${elementName} bind ${bindingName || "(unnamed)"} is missing an export-name`,
      );
      continue;
    }

    const declaredType = availableTypes.get(exportName);
    if (!declaredType) {
      report.errors.push(
        `${itemName} ${elementName} bind ${bindingName || "(unnamed)"} references unknown ${referenceLabel} ${exportName}`,
      );
    } else if (bindingType && declaredType !== bindingType) {
      report.errors.push(
        `${itemName} ${elementName} bind ${bindingName || "(unnamed)"} type ${bindingType} does not match ${exportName} type ${declaredType}`,
      );
    }
  }
}

function collectWorkflowParams(
  root: XmlObject,
  sectionName: "input" | "output" | "attrib",
): ArtifactPreflightParameter[] {
  const section = getObject(root, sectionName);
  if (!section) return [];
  return asArray(section.param)
    .filter(isObject)
    .map((param) => ({
      name: stringValue(param.name),
      type: stringValue(param.type),
      scope: sectionName === "attrib" ? "attribute" : sectionName,
    }));
}

function collectGenericParameters(
  value: unknown,
  report: ArtifactPreflightReport,
): void {
  walkXml(value, (node) => {
    const name = stringValue(node.name);
    const type = stringValue(node.type);
    if (!name || !type) return;

    const scope =
      stringValue(node.scope) ||
      (node["encrypt-value"] !== undefined ? "parameter" : "metadata");
    const parameter = { name, type, scope };
    report.parameters.push(parameter);
    validateParameter(parameter, report);
  });
}

function collectGenericMetadata(
  value: unknown,
  report: ArtifactPreflightReport,
): void {
  walkXml(value, (node) => {
    for (const key of ["id", "name", "module", "fqn", "version", "output-type"]) {
      if (report.metadata[key] === undefined) {
        const value = stringValue(node[key]);
        if (value) report.metadata[key] = value;
      }
    }
  });
}

function collectActionReferencesFromUnknown(
  value: unknown,
  report: ArtifactPreflightReport,
): void {
  walkXml(value, (node) => {
    const script = textValue(node.script) || textValue(node["#text"]);
    if (script) collectActionReferences(script, report);
  });
}

function collectActionReferences(
  script: string,
  report: ArtifactPreflightReport,
): void {
  for (const match of script.matchAll(ACTION_REFERENCE_PATTERN)) {
    const module = match[1] ?? "";
    const action = match[2] ?? "";
    const expression = match[0] ?? "";
    report.actionReferences.push({ module, action, expression });
    report.warnings.push(
      `Action reference ${module}/${action} was found; local preflight cannot prove it exists on the target vRO instance`,
    );
  }
}

function validateParameterList(
  label: string,
  parameters: ArtifactPreflightParameter[],
  report: ArtifactPreflightReport,
): void {
  validateUniqueParameters(label, parameters, report);
  for (const parameter of parameters) {
    validateParameter(parameter, report);
  }
}

function validateParameter(
  parameter: ArtifactPreflightParameter,
  report: ArtifactPreflightReport,
): void {
  if (!parameter.name) {
    report.errors.push(`${parameter.scope} parameter is missing a name`);
  } else if (!IDENTIFIER_PATTERN.test(parameter.name)) {
    report.errors.push(
      `${parameter.scope} parameter ${parameter.name} must be a valid script identifier`,
    );
  }

  if (!parameter.type) {
    report.errors.push(`${parameter.scope} parameter ${parameter.name || "(unnamed)"} is missing a type`);
  } else {
    validateType(
      parameter.type,
      `${parameter.scope} parameter ${parameter.name}`,
      report,
    );
  }
}

function validateUniqueParameters(
  label: string,
  parameters: ArtifactPreflightParameter[],
  report: ArtifactPreflightReport,
): void {
  const seen = new Set<string>();
  for (const parameter of parameters) {
    if (!parameter.name) continue;
    if (seen.has(parameter.name)) {
      report.errors.push(`Duplicate ${label} name: ${parameter.name}`);
    }
    seen.add(parameter.name);
  }
}

function validateType(
  type: string,
  label: string,
  report: ArtifactPreflightReport,
): void {
  if (!TYPE_PATTERN.test(type)) {
    report.errors.push(`${label} uses unsupported or invalid vRO type ${type}`);
  }
}

function getWorkflowItems(root: XmlObject): XmlObject[] {
  return asArray(root["workflow-item"]).filter(isObject);
}

function getBindings(
  item: XmlObject,
  sectionName: "in-binding" | "out-binding",
): XmlObject[] {
  const section = getObject(item, sectionName);
  if (!section) return [];
  return asArray(section.bind).filter(isObject);
}

function getScriptText(item: XmlObject): string {
  const script = item.script;
  if (typeof script === "string") return script;
  if (isObject(script)) return textValue(script["#text"]);
  return "";
}

function decodeUtf8Xml(
  content: Uint8Array,
  entryName: string,
  report: ArtifactPreflightReport,
): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch (error) {
    report.errors.push(`${entryName} is not valid UTF-8 XML: ${errorMessage(error)}`);
    return null;
  }
}

function decodeUtf16XmlWithBom(
  content: Uint8Array,
  entryName: string,
  report: ArtifactPreflightReport,
): string | null {
  if (content.length < 2) {
    report.errors.push(`${entryName} is empty`);
    return null;
  }
  const littleEndian = content[0] === 0xff && content[1] === 0xfe;
  const bigEndian = content[0] === 0xfe && content[1] === 0xff;
  if (!littleEndian && !bigEndian) {
    report.errors.push(`${entryName} must be UTF-16 XML with a BOM`);
    return null;
  }

  const encoding = littleEndian ? "utf-16le" : "utf-16be";
  try {
    return new TextDecoder(encoding).decode(content);
  } catch (error) {
    report.errors.push(`${entryName} is not valid ${encoding} XML: ${errorMessage(error)}`);
    return null;
  }
}

function decodeLikelyXml(content: Uint8Array): string | null {
  if (content.length === 0) return null;
  const xml = content[0] === 0xff && content[1] === 0xfe
    ? new TextDecoder("utf-16le").decode(content)
    : content[0] === 0xfe && content[1] === 0xff
      ? new TextDecoder("utf-16be").decode(content)
      : new TextDecoder("utf-8").decode(content);
  return xml.trimStart().startsWith("<") ? xml : null;
}

function parseXml(
  xml: string,
  entryName: string,
  report: ArtifactPreflightReport,
): XmlObject | null {
  const normalizedXml = xml.replace(/^\uFEFF/, "");
  const validation = XMLValidator.validate(normalizedXml, {
    allowBooleanAttributes: true,
  });
  if (validation !== true) {
    report.errors.push(
      `${entryName} is not well-formed XML: ${validation.err.msg} at line ${validation.err.line}, column ${validation.err.col}`,
    );
    return null;
  }

  try {
    const parsed = parser.parse(normalizedXml);
    return isObject(parsed) ? parsed : null;
  } catch (error) {
    report.errors.push(`${entryName} is not parseable XML: ${errorMessage(error)}`);
    return null;
  }
}

function validateZipEntryName(
  name: string,
  report: ArtifactPreflightReport,
): void {
  if (!name || name.includes("\0")) {
    report.errors.push("Archive contains an empty or invalid entry name");
    return;
  }
  if (name.includes("\\")) {
    report.errors.push(`Archive entry ${name} uses backslashes`);
  }
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    report.errors.push(`Archive entry ${name} is absolute`);
  }
  const normalized = posix.normalize(name);
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    report.errors.push(`Archive entry ${name} escapes the archive root`);
  }
}

function copyMetadata(
  source: XmlObject,
  report: ArtifactPreflightReport,
  keys: string[],
): void {
  for (const key of keys) {
    const value = stringValue(source[key]);
    if (value) report.metadata[key] = value;
  }
}

function walkXml(value: unknown, visitor: (node: XmlObject) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkXml(item, visitor);
    return;
  }
  if (!isObject(value)) return;
  visitor(value);
  for (const child of Object.values(value)) {
    walkXml(child, visitor);
  }
}

function newReport(
  kind: ArtifactKind,
  fileName: string,
): ArtifactPreflightReport {
  return {
    kind,
    fileName,
    valid: false,
    errors: [],
    warnings: [],
    metadata: {},
    entries: [],
    parameters: [],
    actionReferences: [],
  };
}

function nestedKind(name: string): ArtifactKind {
  if (name.endsWith(".workflow")) return "workflow";
  if (name.endsWith(".action")) return "action";
  if (name.endsWith(".vsoconf")) return "configuration";
  return "package";
}

function getObject(value: unknown, key: string): XmlObject | null {
  if (!isObject(value)) return null;
  const child = value[key];
  return isObject(child) ? child : null;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isObject(value: unknown): value is XmlObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textValue).join("");
  }
  if (isObject(value)) {
    return textValue(value["#text"]);
  }
  return "";
}

function title(kind: ArtifactKind): string {
  return kind[0]?.toUpperCase() + kind.slice(1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
