import { unzipSync } from "fflate";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildWorkflowArtifact,
  buildWorkflowContent,
  buildWorkflowContentXml,
} from "../dist/client/workflow-artifact.js";
import { VroClient } from "../dist/vro-client.js";

const config = (overrides = {}) => ({
  host: "vcfa.example.test",
  username: "admin",
  organization: "org",
  password: "secret",
  ...overrides,
});

const workflow = {
  id: "workflow-1",
  name: "Provision <VM>",
  description: "Builds & returns a VM",
  inputs: [{ name: "projectName", type: "string", description: "Project" }],
  outputs: [{ name: "vmCount", type: "number", description: "Count" }],
  attributes: [{ name: "runningTotal", type: "number" }],
  tasks: [
    {
      displayName: "Find project",
      script: 'System.log("lookup ]]> safely");\nrunningTotal = 1;',
      inBindings: [
        { name: "projectName", type: "string", source: "projectName" },
      ],
      outBindings: [
        { name: "runningTotal", type: "number", target: "runningTotal" },
      ],
    },
    {
      name: "finish",
      displayName: "Return count",
      script: "vmCount = runningTotal;",
      inBindings: [
        { name: "runningTotal", type: "number", source: "runningTotal" },
      ],
      outBindings: [{ name: "vmCount", type: "number", target: "vmCount" }],
    },
  ],
};

test("buildWorkflowContent creates UTF-16LE workflow XML with metadata and bindings", () => {
  const content = buildWorkflowContent(workflow);
  assert.equal(content[0], 0xff);
  assert.equal(content[1], 0xfe);

  const xml = new TextDecoder("utf-16le").decode(content);
  assert.match(xml, /<workflow /);
  assert.match(xml, /id="workflow-1"/);
  assert.match(xml, /version="1\.0\.0"/);
  assert.match(xml, /api-version="6\.0\.0"/);
  assert.match(
    xml,
    /<display-name><!\[CDATA\[Provision <VM>\]\]><\/display-name>/,
  );
  assert.match(xml, /<param name="projectName" type="string">/);
  assert.match(xml, /<param name="vmCount" type="number">/);
  assert.match(xml, /<param name="runningTotal" type="number" scope="local">/);
  assert.match(
    xml,
    /<workflow-item name="item1" type="task" out-name="finish">/,
  );
  assert.match(xml, /<workflow-item name="finish" type="task" end-mode="1">/);
  assert.match(
    xml,
    /<bind name="projectName" type="string" export-name="projectName" \/>/,
  );
  assert.match(xml, /System\.log\("lookup \]\]\]\]><!\[CDATA\[> safely"\);/);
});

test("buildWorkflowArtifact creates a .workflow zip with required entries", () => {
  const archive = buildWorkflowArtifact(workflow);
  const files = unzipSync(archive);

  assert.ok(files["workflow-info"]);
  assert.ok(files["workflow-content"]);

  const info = new TextDecoder().decode(files["workflow-info"]);
  assert.match(info, /workflow-info id="workflow-1"/);

  const content = files["workflow-content"];
  assert.equal(content[0], 0xff);
  assert.equal(content[1], 0xfe);
  const xml = new TextDecoder("utf-16le").decode(content);
  assert.match(xml, /<script encoded="false"><!\[CDATA\[/);
});

test("buildWorkflowArtifact reuses generated workflow ID across archive entries", () => {
  const archive = buildWorkflowArtifact({ ...workflow, id: undefined });
  const files = unzipSync(archive);
  const info = new TextDecoder().decode(files["workflow-info"]);
  const xml = new TextDecoder("utf-16le").decode(files["workflow-content"]);

  const infoId = info.match(/id="([^"]+)"/)?.[1];
  const contentId = xml.match(/ id="([^"]+)"/)?.[1];

  assert.ok(infoId);
  assert.equal(contentId, infoId);
});

test("workflow artifact builder rejects structural validation errors", () => {
  assert.throws(
    () =>
      buildWorkflowContentXml({
        name: "Invalid",
        inputs: [{ name: "bad-name", type: "string" }],
        outputs: [{ name: "result", type: "number" }],
        tasks: [
          {
            script: "result = value;",
            inBindings: [
              { name: "value", type: "number", source: "missingInput" },
            ],
            outBindings: [{ name: "result", type: "string", target: "result" }],
          },
        ],
      }),
    /bad-name must be a valid script identifier[\s\S]*unknown source missingInput[\s\S]*type string does not match result type number/,
  );
});

test("scaffoldWorkflowFile writes artifacts safely under workflow directory", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-scaffold-workflows-"));

  try {
    const client = new VroClient(config({ workflowDir }));
    const savedPath = await client.scaffoldWorkflowFile({
      fileName: "generated.workflow",
      workflow,
    });

    assert.equal(
      savedPath,
      join(await realpath(workflowDir), "generated.workflow"),
    );
    const files = unzipSync(new Uint8Array(await readFile(savedPath)));
    assert.ok(files["workflow-content"]);

    await assert.rejects(
      () =>
        client.scaffoldWorkflowFile({
          fileName: "generated.workflow",
          workflow,
        }),
      /already exists/,
    );

    await client.scaffoldWorkflowFile({
      fileName: "generated.workflow",
      overwrite: true,
      workflow: { ...workflow, description: "replacement" },
    });
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

test("scaffoldWorkflowFile rejects unsafe target paths and symlink targets", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-scaffold-workflows-"));
  const outsideFile = join(tmpdir(), `outside-${Date.now()}.workflow`);
  await writeFile(outsideFile, "outside");
  await symlink(outsideFile, join(workflowDir, "linked.workflow"));

  try {
    const client = new VroClient(config({ workflowDir }));

    await assert.rejects(
      () =>
        client.scaffoldWorkflowFile({
          fileName: "../generated.workflow",
          workflow,
        }),
      /must not contain path separators/,
    );
    await assert.rejects(
      () =>
        client.scaffoldWorkflowFile({
          fileName: "generated.txt",
          workflow,
        }),
      /must end with \.workflow/,
    );
    await assert.rejects(
      () =>
        client.scaffoldWorkflowFile({
          fileName: "linked.workflow",
          overwrite: true,
          workflow,
        }),
      /must not be a symbolic link/,
    );
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
});
