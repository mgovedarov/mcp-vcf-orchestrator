import assert from "node:assert/strict";
import { basename } from "node:path";
import test from "node:test";
import { sourceCitationProblems } from "../scripts/validate-docs.mjs";

const files = {
  "src/client/core.ts": "export async function apiError() {}\n",
  "src/tools/template-tools.ts":
    '// legacyHelper was folded into the handler.\nserver.registerTool("delete-template", {});\nconst label = "api-error";\n',
  "package.json": '{ "engines": { "node": ">=22" } }\n',
};

const repo = {
  exists: (path) => path in files || path === "src/client/",
  readText: (path) => files[path],
  fileNamed: (name) => Object.keys(files).some((path) => basename(path) === name),
};

function problems(text) {
  return sourceCitationProblems("doc.md", text, repo);
}

test("a line-number citation into a source file fails", () => {
  assert.deepEqual(problems("See `src/client/core.ts:1301-1313`."), [
    "doc.md: line-number citation `src/client/core.ts:1301-1313`; cite the file and a symbol instead",
  ]);
  assert.equal(problems("Lines `src/index.ts:32,118` and `ci.yml:60`.").length, 2);
});

test("a host with a port is not a line-number citation", () => {
  assert.deepEqual(problems("Set `vro.example.com:443` as the host."), []);
});

test("a cited repo path must exist", () => {
  assert.deepEqual(problems("See `src/client/gone.ts` and `src/client/`."), [
    "doc.md: cited path src/client/gone.ts does not exist",
  ]);
});

test("placeholders, globs, and extensionless category paths are not citations", () => {
  assert.deepEqual(
    problems(
      "Edit `src/tools/*-tools.ts`, `skills/<name>/SKILL.md`, or `.agents/roles/{role}.md`; the category is `test/minko`.",
    ),
    [],
  );
});

test("a symbol cited in a file must still be in that file", () => {
  assert.deepEqual(
    problems(
      "Built by `apiError` in `src/client/core.ts`, pinned by `engines` in `package.json`.",
    ),
    [],
  );
  assert.deepEqual(problems("Built by `buildError` in `src/client/core.ts`."), [
    "doc.md: `buildError` is not in src/client/core.ts",
  ]);
});

test("a cited symbol must match a whole identifier, not a prefix of one", () => {
  assert.deepEqual(problems("Built by `apiErr` in `src/client/core.ts`."), [
    "doc.md: `apiErr` is not in src/client/core.ts",
  ]);
});

test("a dot in a cited symbol matches only a literal dot", () => {
  const dotted = {
    exists: (path) => path === "src/index.ts",
    readText: () => "serverXregisterTool(name);\n",
  };
  assert.deepEqual(
    sourceCitationProblems(
      "doc.md",
      "Registered by `server.registerTool` in `src/index.ts`.",
      dotted,
    ),
    ["doc.md: `server.registerTool` is not in src/index.ts"],
  );
});

test("a symbol cited in a bare file name or a directory is not checked", () => {
  assert.deepEqual(
    problems("`apiError` in `core.ts`; `apiError` in `src/client/`."),
    [],
  );
});

test("fenced code blocks are skipped", () => {
  assert.deepEqual(
    problems("```sh\ngit show HEAD:`src/client/core.ts:12`\n```\nDone."),
    [],
  );
});

test("indented and tilde fences are skipped, and a longer fence holds a shorter one", () => {
  assert.deepEqual(
    problems("1. Run:\n   ```sh\n   cat `src/client/core.ts:12`\n   ```\n"),
    [],
  );
  assert.deepEqual(problems("~~~\n`src/client/gone.ts`\n~~~\n"), []);
  assert.deepEqual(
    problems("````md\n```\n`src/client/gone.ts`\n```\n````\nSee `src/tools/gone.ts`."),
    ["doc.md: cited path src/tools/gone.ts does not exist"],
  );
});

test("a line-number citation outside backticks fails", () => {
  const citation = (path) => [
    `doc.md: line-number citation \`${path}\`; cite the file and a symbol instead`,
  ];
  assert.deepEqual(
    problems("See [core](src/client/core.ts:12)."),
    citation("src/client/core.ts:12"),
  );
  assert.deepEqual(
    problems("See src/client/core.ts:12 for it."),
    citation("src/client/core.ts:12"),
  );
  assert.deepEqual(
    problems("See `src/client/core.ts#L12-L20`."),
    citation("src/client/core.ts#L12-L20"),
  );
  assert.equal(
    problems(
      "[core](https://github.com/owner/repo/blob/main/src/client/core.ts#L120)",
    ).length,
    1,
  );
});

test("a line-number citation under a repo root fails whatever the extension, once", () => {
  assert.deepEqual(problems("See `examples/hello.workflow:3`."), [
    "doc.md: line-number citation `examples/hello.workflow:3`; cite the file and a symbol instead",
  ]);
  assert.deepEqual(problems("See `docs/.vitepress/theme/Layout.vue:3`."), [
    "doc.md: line-number citation `docs/.vitepress/theme/Layout.vue:3`; cite the file and a symbol instead",
  ]);
});

test("a bare file name must name a file somewhere in the repository", () => {
  assert.deepEqual(problems("See `package.json` and `core.ts`."), []);
  assert.deepEqual(problems("See `pakage.json`."), [
    "doc.md: cited path pakage.json does not exist",
  ]);
  assert.deepEqual(
    problems(
      "Call `System.log` on `vcfa.example.com`; export a `.workflow` or `.nvmrc`.",
    ),
    [],
  );
});

test("a bare file a symbol is cited in must exist, whatever its extension", () => {
  assert.deepEqual(problems("Read `foo` in `tsconfig.jsn`."), [
    "doc.md: cited path tsconfig.jsn does not exist",
  ]);
  assert.deepEqual(problems("Called by `server.connect` in `main`."), []);
});

test("a cited symbol must be in code or a string, not only in a comment", () => {
  assert.deepEqual(
    problems("Registered as `delete-template` in `src/tools/template-tools.ts`."),
    [],
  );
  assert.deepEqual(
    problems("Built by `legacyHelper` in `src/tools/template-tools.ts`."),
    ["doc.md: `legacyHelper` is not in src/tools/template-tools.ts"],
  );
});

test("a cited symbol does not match the tail of a kebab-case name", () => {
  assert.deepEqual(problems("Labeled `error` in `src/tools/template-tools.ts`."), [
    "doc.md: `error` is not in src/tools/template-tools.ts",
  ]);
});
