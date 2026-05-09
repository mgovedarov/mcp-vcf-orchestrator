#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function walk(dir, predicate = () => true) {
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = join(dir, entry.name);
    if (entry.isDirectory()) return walk(relative, predicate);
    return predicate(relative) ? [relative] : [];
  });
}

function propertyName(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return undefined;
}

function stringLiteral(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

function objectProperty(objectLiteral, name) {
  return objectLiteral.properties.find(
    (prop) =>
      ts.isPropertyAssignment(prop) && propertyName(prop.name) === name,
  );
}

function objectKeys(node) {
  if (!node) return new Set();
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "object" &&
    node.arguments[0] &&
    ts.isObjectLiteralExpression(node.arguments[0])
  ) {
    return objectKeys(node.arguments[0]);
  }
  if (!ts.isObjectLiteralExpression(node)) return new Set();
  return new Set(
    node.properties
      .filter(ts.isPropertyAssignment)
      .map((prop) => propertyName(prop.name))
      .filter(Boolean),
  );
}

function callName(node) {
  return ts.isPropertyAccessExpression(node.expression)
    ? node.expression.name.text
    : undefined;
}

function sourceFiles(paths) {
  return paths.map((path) =>
    ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true),
  );
}

function collectRegistry() {
  const tools = new Map();
  const prompts = new Map();
  const resources = new Set();
  const files = sourceFiles([
    ...walk("src/tools", (path) => extname(path) === ".ts"),
    "src/prompts/index.ts",
    "src/resources/index.ts",
  ]);

  for (const sourceFile of files) {
    const visit = (node) => {
      if (ts.isCallExpression(node) && callName(node) === "registerTool") {
        const name = stringLiteral(node.arguments[0]);
        const config = node.arguments[1];
        if (name && ts.isObjectLiteralExpression(config)) {
          tools.set(
            name,
            objectKeys(objectProperty(config, "inputSchema")?.initializer),
          );
        }
      }

      if (ts.isCallExpression(node) && callName(node) === "registerPrompt") {
        const name = stringLiteral(node.arguments[0]);
        const config = node.arguments[1];
        if (name && ts.isObjectLiteralExpression(config)) {
          prompts.set(
            name,
            objectKeys(objectProperty(config, "argsSchema")?.initializer),
          );
        }
      }

      if (ts.isCallExpression(node) && callName(node) === "registerResource") {
        const uriArg = node.arguments[1];
        if (uriArg) {
          const direct = stringLiteral(uriArg);
          if (direct) resources.add(direct);
          if (ts.isNewExpression(uriArg)) {
            const template = stringLiteral(uriArg.arguments?.[0]);
            if (template) resources.add(template);
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { tools, prompts, resources };
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function diff(expected, actual) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    missing: sorted(expected).filter((value) => !actualSet.has(value)),
    stale: sorted(actual).filter((value) => !expectedSet.has(value)),
  };
}

function assertNoDiff(label, result) {
  assert.deepEqual(result.missing, [], `${label} missing from docs`);
  assert.deepEqual(result.stale, [], `${label} documented but not registered`);
}

function validateReferenceDrift(registry) {
  const toolDocs = [
    ...read("docs/reference/tools.md").matchAll(/^### `([^`]+)`/gm),
  ].map((match) => match[1]);
  const promptDocs = [
    ...read("docs/reference/resources-prompts.md").matchAll(/^### `([^`]+)`/gm),
  ]
    .map((match) => match[1])
    .filter((name) => name.startsWith("vcfa-"));
  const resourceDocs = [
    ...read("docs/reference/resources-prompts.md").matchAll(
      /`(vcfa:\/\/[^`]+)`/g,
    ),
  ].map((match) => match[1]);

  assertNoDiff("Tools", diff(registry.tools.keys(), toolDocs));
  assertNoDiff("Prompts", diff(registry.prompts.keys(), promptDocs));
  assertNoDiff("Resources", diff(registry.resources, resourceDocs));
}

function markdownFiles() {
  return [
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    ...walk("docs", (path) => extname(path) === ".md"),
    ...walk("examples", (path) => extname(path) === ".md"),
  ].filter((path) => existsSync(join(root, path)));
}

function validateMarkdownLinks(files) {
  const failures = [];
  for (const file of files) {
    const text = read(file);
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      let target = match[1].trim();
      if (target.startsWith("<") && target.endsWith(">")) {
        target = target.slice(1, -1);
      }
      target = target.split(/\s+/)[0].split("#")[0];
      if (
        !target ||
        target.startsWith("http://") ||
        target.startsWith("https://") ||
        target.startsWith("mailto:") ||
        target.startsWith("vcfa://") ||
        target.startsWith("#")
      ) {
        continue;
      }
      if (!existsSync(resolve(root, dirname(file), target))) {
        failures.push(`${file}: missing link target ${match[1]}`);
      }
    }
  }
  assert.deepEqual(failures, [], "Broken local Markdown links");
}

function balancedText(text, openParenIndex) {
  let depth = 1;
  let quote;
  let escaped = false;
  for (let index = openParenIndex + 1; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      escaped = char === "\\" && !escaped;
      if (char === quote && !escaped) quote = undefined;
      if (char !== "\\") escaped = false;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") depth += 1;
    if (char === ")" || char === "}" || char === "]") depth -= 1;
    if (depth === 0) return text.slice(openParenIndex + 1, index);
  }
  return undefined;
}

function topLevelArgumentNames(argumentText) {
  const names = new Set();
  let depth = 0;
  let quote;
  let escaped = false;
  for (let index = 0; index < argumentText.length; index += 1) {
    const char = argumentText[index];
    if (quote) {
      escaped = char === "\\" && !escaped;
      if (char === quote && !escaped) quote = undefined;
      if (char !== "\\") escaped = false;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") depth += 1;
    if (char === ")" || char === "}" || char === "]") depth -= 1;
    if (depth !== 0 || !/[A-Za-z_]/.test(char)) continue;

    const rest = argumentText.slice(index);
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(rest);
    if (match) {
      names.add(match[1]);
      index += match[0].length - 1;
    }
  }
  return names;
}

function validateExampleToolCalls(files, registry) {
  const failures = [];
  for (const file of files) {
    const text = read(file);

    for (const match of text.matchAll(/\b([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\s*\(/g)) {
      const name = match[1];
      if (!registry.tools.has(name)) {
        if (!registry.prompts.has(name)) {
          failures.push(`${file}: unknown documented call ${name}()`);
        }
        continue;
      }

      const argumentText = balancedText(text, match.index + match[0].length - 1);
      if (!argumentText) continue;
      const allowed = registry.tools.get(name);
      for (const argName of topLevelArgumentNames(argumentText)) {
        if (!allowed.has(argName)) {
          failures.push(`${file}: ${name}() uses unknown argument ${argName}`);
        }
      }
    }

    for (const match of text.matchAll(/Use prompt\s+([a-z0-9-]+)\s+with:/g)) {
      if (!registry.prompts.has(match[1])) {
        failures.push(`${file}: unknown prompt example ${match[1]}`);
      }
    }

    for (const match of text.matchAll(/Use\s+([a-z0-9-]+)\s+with:/g)) {
      if (match[1] === "prompt") continue;
      if (!registry.tools.has(match[1])) {
        failures.push(`${file}: unknown tool example ${match[1]}`);
      }
    }
  }

  assert.deepEqual(failures, [], "Documented examples must reference current tools and arguments");
}

const registry = collectRegistry();
const files = markdownFiles();

validateReferenceDrift(registry);
validateMarkdownLinks(files);
validateExampleToolCalls(files, registry);

console.log(
  `Validated docs drift and examples: ${registry.tools.size} tools, ${registry.prompts.size} prompts, ${registry.resources.size} resources, ${files.length} markdown files.`,
);
