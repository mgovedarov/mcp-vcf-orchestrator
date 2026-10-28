import assert from "node:assert/strict";
import test from "node:test";
import { sourceCitationProblems } from "../scripts/validate-docs.mjs";

const files = {
  "src/client/core.ts": "export async function apiError() {}\n",
  "package.json": '{ "engines": { "node": ">=22" } }\n',
};

const repo = {
  exists: (path) => path in files || path === "src/client/",
  readText: (path) => files[path],
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
