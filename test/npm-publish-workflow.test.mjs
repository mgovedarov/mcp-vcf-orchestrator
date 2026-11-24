import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = resolve(root, ".github/workflows/npm-publish.yml");

// Every `npm publish` command line in the workflow, comments excluded.
function publishCommands(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#"))
    .filter((line) => /^npm\s+publish\b/.test(line));
}

// The first argument after `npm publish`, with surrounding quotes removed.
function publishSpec(command) {
  const match = /^npm\s+publish\s+("[^"]*"|'[^']*'|\S+)/.exec(command);
  assert.ok(match, `no package spec on the publish line: ${command}`);
  return match[1].replace(/^(["'])(.*)\1$/, "$2");
}

// npm parses a bare relative path such as `package-tarball/<name>.tgz` as a
// GitHub `owner/repo` shorthand and tries `git ls-remote` over SSH, so the
// release publish exits 128 without publishing (VCFO-126, v3.3.1). A `./`
// prefix makes npm read the spec as a local file. This is a text check only:
// nothing in `npm run validate` runs the publish job.
test("the npm publish workflow passes the tarball as a ./-prefixed file spec", () => {
  const commands = publishCommands(readFileSync(workflowPath, "utf8"));
  assert.ok(
    commands.length > 0,
    "expected at least one `npm publish` command in .github/workflows/npm-publish.yml",
  );
  for (const command of commands) {
    const spec = publishSpec(command);
    assert.ok(
      spec.startsWith("./"),
      `npm publish must receive a ./-prefixed tarball path, got ${JSON.stringify(spec)}`,
    );
  }
});

test("the publish spec check rejects the bare relative form that broke v3.3.1", () => {
  const bare = publishCommands('          npm publish "$1" --access public --provenance');
  assert.equal(bare.length, 1);
  assert.equal(publishSpec(bare[0]).startsWith("./"), false);

  const fixed = publishCommands('          npm publish "./$1" --access public --provenance');
  assert.equal(publishSpec(fixed[0]), "./$1");
});
