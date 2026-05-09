#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = mkdtempSync(join(tmpdir(), "mcp-vcf-orchestrator-npm-cache-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  const result = spawnSync(npm, ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cacheDir },
  });

  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  const packages = JSON.parse(result.stdout);
  const files = new Set(packages[0].files.map((file) => file.path));

  const requiredFiles = [
    "README.md",
    "package.json",
    "dist/index.js",
    "dist/client/index.js",
    "dist/tools/workflow-tools.js",
    "docs/index.md",
    "docs/reference/tools.md",
    "docs/reference/resources-prompts.md",
    "docs/vro-artifact-authoring.md",
    "examples/README.md",
    "examples/workflow-artifact.md",
    "examples/artifact-promotion.md",
    "examples/template-catalog-subscription.md",
  ];

  const forbiddenPatterns = [
    /^src\//,
    /^test\//,
    /^scripts\//,
    /^artifacts\//,
    /^node_modules\//,
    /^coverage\//,
    /^docs\/\.vitepress\//,
    /^\.env$/,
    /^\.env\.example$/,
    /^\.npmrc$/,
    /^tsconfig\.json$/,
    /^package-lock\.json$/,
  ];

  assert.deepEqual(
    requiredFiles.filter((file) => !files.has(file)),
    [],
    "npm package is missing required files",
  );

  assert.deepEqual(
    [...files].filter((file) =>
      forbiddenPatterns.some((pattern) => pattern.test(file)),
    ),
    [],
    "npm package contains files that should not be published",
  );

  console.log(
    `Validated npm package contents: ${packages[0].files.length} files, ${packages[0].unpackedSize} unpacked bytes.`,
  );
} finally {
  rmSync(cacheDir, { recursive: true, force: true });
}
