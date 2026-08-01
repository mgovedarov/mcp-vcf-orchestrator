#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// --- Source registry collection ---------------------------------------------
//
// Collects registered tool, prompt, and resource names (plus schema keys) by
// scanning the TypeScript sources as text. typescript@7 (the native compiler)
// removed the stable compiler API this used to rely on (ts.createSourceFile,
// ts.forEachChild, ...), leaving only explicitly unstable subpath APIs, so the
// scanner depends on nothing beyond the source text itself. Any inaccuracy
// fails loudly: a name it misses or invents shows up as drift against docs.
//
// maskSource() first blanks everything that is not code structure: comments
// and regex literals become spaces entirely; string/template contents become
// spaces while keeping their delimiters (and `${`/`}` markers, so templates
// with substitutions stay distinguishable and brace-balanced). The masked
// text is the same length as the original, so spans located on the masked
// text read their values out of the original.

// Tokens after which a `/` starts a regex literal rather than a division.
const REGEX_PRECEDING_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

const REGEX_PRECEDING_CHARS = new Set([..."=(,:[!&|?{};+-*/%~^<"]);

export function maskSource(text) {
  const out = new Array(text.length).fill(" ");
  // One entry per open template substitution: its unmatched `{` count.
  const substitutions = [];
  let mode = "code";
  let prev = "";
  let prevPrev = "";
  let word = "";

  const regexCanStart = () => {
    if (word) return REGEX_PRECEDING_KEYWORDS.has(word);
    if (!prev) return true;
    if (prev === ">") return prevPrev === "="; // arrow function body
    return REGEX_PRECEDING_CHARS.has(prev);
  };
  const backToCode = (operandChar) => {
    mode = "code";
    prevPrev = prev;
    prev = operandChar;
    word = "";
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (mode === "line") {
      if (char === "\n") mode = "code";
      continue;
    }
    if (mode === "block") {
      if (char === "*" && next === "/") {
        mode = "code";
        i += 1;
      }
      continue;
    }
    if (mode === "single" || mode === "double") {
      const quote = mode === "single" ? "'" : '"';
      if (char === "\\") {
        i += 1;
        continue;
      }
      if (char === quote) {
        out[i] = char;
        backToCode(quote);
      } else if (char === "\n") {
        backToCode(quote);
      }
      continue;
    }
    if (mode === "template") {
      if (char === "\\") {
        i += 1;
        continue;
      }
      if (char === "`") {
        out[i] = char;
        backToCode("`");
        continue;
      }
      if (char === "$" && next === "{") {
        out[i] = "$";
        out[i + 1] = "{";
        substitutions.push(0);
        backToCode("{");
        i += 1;
      }
      continue;
    }
    if (mode === "regex" || mode === "regexClass") {
      if (char === "\\") {
        i += 1;
        continue;
      }
      if (mode === "regex" && char === "[") {
        mode = "regexClass";
      } else if (mode === "regexClass" && char === "]") {
        mode = "regex";
      } else if (mode === "regex" && char === "/") {
        while (/[a-z]/iu.test(text[i + 1] ?? "")) i += 1; // flags
        backToCode(")"); // a regex literal is an operand
      }
      continue;
    }

    // mode === "code"
    if (char === "/" && next === "/") {
      mode = "line";
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      mode = "block";
      i += 1;
      continue;
    }
    if (char === "/" && regexCanStart()) {
      mode = "regex";
      continue;
    }
    if (char === "'" || char === '"') {
      out[i] = char;
      mode = char === "'" ? "single" : "double";
      continue;
    }
    if (char === "`") {
      out[i] = char;
      mode = "template";
      continue;
    }
    if (char === "{" && substitutions.length > 0) {
      substitutions[substitutions.length - 1] += 1;
    }
    if (char === "}" && substitutions.length > 0) {
      if (substitutions[substitutions.length - 1] === 0) {
        substitutions.pop();
        out[i] = "}";
        mode = "template";
        continue;
      }
      substitutions[substitutions.length - 1] -= 1;
    }

    out[i] = char;
    if (/\s/.test(char)) continue;
    if (/[A-Za-z0-9_$]/.test(char)) {
      word = i > 0 && /[A-Za-z0-9_$]/.test(text[i - 1]) ? word + char : char;
    } else {
      word = "";
    }
    prevPrev = prev;
    prev = char;
  }
  return out.join("");
}

// Masked text has no live bracket characters inside strings, comments, or
// regexes, so plain depth counting finds the matching close bracket.
function balancedEnd(masked, openIndex) {
  let depth = 1;
  for (let i = openIndex + 1; i < masked.length; i += 1) {
    const char = masked[i];
    if (char === "(" || char === "{" || char === "[") depth += 1;
    else if (char === ")" || char === "}" || char === "]") depth -= 1;
    if (depth === 0) return i;
  }
  return -1;
}

function trimSpan(masked, start, end) {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(masked[s])) s += 1;
  while (e > s && /\s/.test(masked[e - 1])) e -= 1;
  return [s, e];
}

function splitTopLevelArguments(masked, start, end) {
  const spans = [];
  let depth = 0;
  let argStart = start;
  for (let i = start; i < end; i += 1) {
    const char = masked[i];
    if (char === "(" || char === "{" || char === "[") depth += 1;
    else if (char === ")" || char === "}" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      spans.push(trimSpan(masked, argStart, i));
      argStart = i + 1;
    }
  }
  spans.push(trimSpan(masked, argStart, end));
  return spans.filter(([s, e]) => s < e);
}

// Returns the text of a plain string literal (or substitution-free template
// literal) span, undefined for anything else. Values are read raw; registered
// names and URIs contain no escape sequences.
function stringLiteralValue(text, masked, [start, end]) {
  if (end - start < 2) return undefined;
  const quote = masked[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
  if (masked[end - 1] !== quote) return undefined;
  const inner = masked.slice(start + 1, end - 1);
  if (inner.includes(quote)) return undefined; // concatenations etc.
  if (quote === "`" && inner.includes("$")) return undefined; // substitutions
  return text.slice(start + 1, end - 1);
}

// Maps each top-level `key:` entry of an object literal span to its value
// span. Shorthand properties, methods, spreads, and computed keys are
// skipped, matching what the previous AST walk counted.
function topLevelObjectEntries(text, masked, [start, end]) {
  const entries = new Map();
  if (masked[start] !== "{" || masked[end - 1] !== "}") return entries;
  const stop = end - 1;
  let i = start + 1;

  const skipToComma = () => {
    let depth = 0;
    while (i < stop) {
      const char = masked[i];
      if (char === "(" || char === "{" || char === "[") depth += 1;
      else if (char === ")" || char === "}" || char === "]") depth -= 1;
      else if (char === "," && depth === 0) return;
      i += 1;
    }
  };

  while (i < stop) {
    while (i < stop && /[\s,]/.test(masked[i])) i += 1;
    if (i >= stop) break;

    let key;
    const char = masked[i];
    if (char === '"' || char === "'") {
      const close = masked.indexOf(char, i + 1);
      if (close === -1 || close >= stop) break;
      key = text.slice(i + 1, close);
      i = close + 1;
    } else if (/[A-Za-z_$]/.test(char)) {
      const keyStart = i;
      while (i < stop && /[A-Za-z0-9_$]/.test(masked[i])) i += 1;
      key = text.slice(keyStart, i);
    } else {
      skipToComma();
      continue;
    }

    while (i < stop && /\s/.test(masked[i])) i += 1;
    if (masked[i] !== ":") {
      skipToComma();
      continue;
    }
    i += 1;
    const valueStart = i;
    skipToComma();
    const span = trimSpan(masked, valueStart, i);
    if (key && span[0] < span[1]) entries.set(key, span);
  }
  return entries;
}

// Top-level keys of a schema value: unwraps builder calls shaped like
// `z.object({ ... })`, then reads the object literal's keys.
function schemaKeys(text, masked, span) {
  if (!span) return new Set();
  let [start, end] = trimSpan(masked, span[0], span[1]);
  for (;;) {
    const call = /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*?\s*\.\s*object\s*\(/.exec(
      masked.slice(start, end),
    );
    if (!call) break;
    const open = start + call[0].length - 1;
    const close = balancedEnd(masked, open);
    if (close === -1 || close > end) return new Set();
    const args = splitTopLevelArguments(masked, open + 1, close);
    if (!args.length) return new Set();
    [start, end] = args[0];
  }
  if (masked[start] !== "{") return new Set();
  return new Set(topLevelObjectEntries(text, masked, [start, end]).keys());
}

const REGISTRATION_PATTERN = /\.\s*register(Tool|Prompt|Resource)\s*\(/g;

export function collectRegistryFromSources(sources) {
  const tools = new Map();
  const prompts = new Map();
  const resources = new Set();

  for (const { text } of sources) {
    const masked = maskSource(text);
    for (const match of masked.matchAll(REGISTRATION_PATTERN)) {
      const kind = match[1];
      const open = match.index + match[0].length - 1;
      const close = balancedEnd(masked, open);
      if (close === -1) continue;
      const args = splitTopLevelArguments(masked, open + 1, close);

      if (kind === "Tool" || kind === "Prompt") {
        const name = args[0] && stringLiteralValue(text, masked, args[0]);
        if (!name || !args[1] || masked[args[1][0]] !== "{") continue;
        const entries = topLevelObjectEntries(text, masked, args[1]);
        const keys = schemaKeys(
          text,
          masked,
          entries.get(kind === "Tool" ? "inputSchema" : "argsSchema"),
        );
        (kind === "Tool" ? tools : prompts).set(name, keys);
        continue;
      }

      // Resource: the second argument is the URI string, or a template class
      // instantiation whose first argument is the URI template string.
      const uriSpan = args[1];
      if (!uriSpan) continue;
      const direct = stringLiteralValue(text, masked, uriSpan);
      if (direct) {
        resources.add(direct);
        continue;
      }
      if (/^new\b/.test(masked.slice(uriSpan[0], uriSpan[1]))) {
        const templateOpen = masked.indexOf("(", uriSpan[0]);
        if (templateOpen === -1 || templateOpen >= uriSpan[1]) continue;
        const templateClose = balancedEnd(masked, templateOpen);
        if (templateClose === -1 || templateClose > uriSpan[1]) continue;
        const inner = splitTopLevelArguments(
          masked,
          templateOpen + 1,
          templateClose,
        );
        const template = inner[0] && stringLiteralValue(text, masked, inner[0]);
        if (template) resources.add(template);
      }
    }
  }

  return { tools, prompts, resources };
}

export function collectRegistry() {
  const paths = [
    ...walk("src/tools", (path) => extname(path) === ".ts"),
    "src/prompts/index.ts",
    "src/resources/index.ts",
  ];
  return collectRegistryFromSources(
    paths.map((path) => ({ path, text: read(path) })),
  );
}

// --- Docs validation ---------------------------------------------------------

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

function skillFiles() {
  return walk("skills", (path) => extname(path) === ".md");
}

function markdownFiles() {
  return [
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    ...walk("docs", (path) => extname(path) === ".md"),
    ...walk("examples", (path) => extname(path) === ".md"),
    ...skillFiles(),
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

// Legitimate kebab-case tokens used in skill prose that are not registered tool,
// prompt, or resource names: plugin/skill/marketplace identifiers and the
// workflow/template/subscription pattern slugs. A renamed tool still referenced
// in a SKILL.md fails the check below; a genuinely new non-tool term is a
// one-line addition here.
const KNOWN_NON_REGISTRY_TERMS = new Set([
  "vcfa-orchestrator",
  "vcfa-authoring",
  "vcfa-operations",
  "mcp-vcf-orchestrator",
  "basic-scriptable-task",
  "action-wrapper",
  "small-vm",
  "catalog-ready",
  "event-driven",
]);

const TOOL_TOKEN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

function validateSkillReferences(registry, skills) {
  const failures = [];
  for (const file of skills) {
    const text = read(file);
    for (const match of text.matchAll(/`([^`]+)`/g)) {
      const token = match[1].trim();
      if (token.startsWith("vcfa://")) {
        if (!registry.resources.has(token)) {
          failures.push(`${file}: unknown resource reference ${token}`);
        }
        continue;
      }
      if (!TOOL_TOKEN.test(token)) continue;
      if (
        registry.tools.has(token) ||
        registry.prompts.has(token) ||
        KNOWN_NON_REGISTRY_TERMS.has(token)
      ) {
        continue;
      }
      failures.push(`${file}: unknown tool/prompt reference ${token}`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    "Skill files must reference current tools, prompts, and resources",
  );
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const registry = collectRegistry();
  const files = markdownFiles();
  const skills = skillFiles();

  validateReferenceDrift(registry);
  validateMarkdownLinks(files);
  validateExampleToolCalls(files, registry);
  validateSkillReferences(registry, skills);

  console.log(
    `Validated docs drift and examples: ${registry.tools.size} tools, ${registry.prompts.size} prompts, ${registry.resources.size} resources, ${files.length} markdown files (${skills.length} skill files).`,
  );
}
