import { zipSync } from "fflate";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  diffActionArtifacts,
  diffWorkflowArtifacts,
  inspectActionArtifactBuffer,
  inspectWorkflowArtifactBuffer,
  preflightActionFile,
  preflightPackageFile,
  preflightWorkflowFile,
} from "../dist/client/artifact-preflight.js";
import { buildWorkflowArtifact } from "../dist/client/workflow-artifact.js";
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
  name: "Generated Workflow",
  inputs: [{ name: "message", type: "string" }],
  outputs: [{ name: "result", type: "string" }],
  tasks: [
    {
      script: 'result = System.getModule("com.example.actions").echo(message);',
      inBindings: [{ name: "message", type: "string", source: "message" }],
      outBindings: [{ name: "result", type: "string", target: "result" }],
    },
  ],
};

test("preflightWorkflowFile accepts generated workflow artifacts and reports action references", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-"));
  await writeFile(
    join(workflowDir, "generated.workflow"),
    buildWorkflowArtifact(workflow),
  );

  try {
    const report = await preflightWorkflowFile(
      workflowDir,
      "generated.workflow",
    );

    assert.equal(report.valid, true);
    assert.equal(report.errors.length, 0);
    assert.match(report.metadata.name, /Generated Workflow/);
    assert.deepEqual(report.parameters, [
      { name: "message", type: "string", scope: "input" },
      { name: "result", type: "string", scope: "output" },
    ]);
    assert.deepEqual(report.actionReferences, [
      {
        module: "com.example.actions",
        action: "echo",
        expression: 'System.getModule("com.example.actions").echo(',
      },
    ]);
    assert.match(report.warnings[0], /cannot prove it exists/);
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

test("preflightWorkflowFile reports malformed ZIPs, missing entries, and bad encoding", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-"));
  await writeFile(join(workflowDir, "bad.workflow"), "not a zip");
  await writeFile(
    join(workflowDir, "missing.workflow"),
    zipSync({
      "workflow-info": new TextEncoder().encode(
        '<workflow-info id="workflow-1" name="Missing" />',
      ),
    }),
  );
  await writeFile(
    join(workflowDir, "utf8.workflow"),
    zipSync({
      "workflow-info": new TextEncoder().encode(
        '<workflow-info id="workflow-1" name="UTF8" />',
      ),
      "workflow-content": new TextEncoder().encode("<workflow />"),
    }),
  );
  const malformedXml = [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<workflow root-name="item1">',
    "  <input />",
    "  <output />",
    "  <attrib />",
    '  <workflow-item name="item1" type="task" end-mode="1">',
    "    <in-binding />",
    "    <out-binding />",
    "    <script>System.log('bad');</scriptx>",
    "  </workflow-item>",
    "</workflow>",
  ].join("\n");
  await writeFile(
    join(workflowDir, "malformed.workflow"),
    zipSync({
      "workflow-info": new TextEncoder().encode(
        '<workflow-info id="workflow-1" name="Malformed" />',
      ),
      "workflow-content": utf16LeWithBom(malformedXml),
    }),
  );

  try {
    const bad = await preflightWorkflowFile(workflowDir, "bad.workflow");
    assert.equal(bad.valid, false);
    assert.match(bad.errors.join("\n"), /valid ZIP archive/);

    const missing = await preflightWorkflowFile(
      workflowDir,
      "missing.workflow",
    );
    assert.equal(missing.valid, false);
    assert.match(missing.errors.join("\n"), /Missing required workflow-content/);

    const utf8 = await preflightWorkflowFile(workflowDir, "utf8.workflow");
    assert.equal(utf8.valid, false);
    assert.match(utf8.errors.join("\n"), /UTF-16 XML with a BOM/);

    const malformed = await preflightWorkflowFile(
      workflowDir,
      "malformed.workflow",
    );
    assert.equal(malformed.valid, false);
    assert.match(malformed.errors.join("\n"), /not well-formed XML/);
    assert.match(malformed.errors.join("\n"), /scriptx/);
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

test("preflightWorkflowFile reports binding and parameter validation errors", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-"));
  const invalidXml = [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<workflow id="workflow-1" root-name="missingRoot">',
    "  <input>",
    '    <param name="message" type="string" />',
    '    <param name="message" type="string" />',
    "  </input>",
    "  <output>",
    '    <param name="result" type="number" />',
    "  </output>",
    '  <workflow-item name="item1" type="task">',
    '    <in-binding><bind name="bad-name" type="string" export-name="unknown" /></in-binding>',
    '    <out-binding><bind name="result" type="string" export-name="result" /></out-binding>',
    "    <script></script>",
    "  </workflow-item>",
    "</workflow>",
  ].join("\n");
  await writeFile(
    join(workflowDir, "invalid.workflow"),
    zipSync({
      "workflow-info": new TextEncoder().encode(
        '<workflow-info id="workflow-1" name="Invalid" />',
      ),
      "workflow-content": utf16LeWithBom(invalidXml),
    }),
  );

  try {
    const report = await preflightWorkflowFile(workflowDir, "invalid.workflow");
    const errors = report.errors.join("\n");
    assert.equal(report.valid, false);
    assert.match(errors, /Duplicate input name: message/);
    assert.match(errors, /root-name references unknown item missingRoot/);
    assert.match(errors, /bad-name must be a valid script identifier/);
    assert.match(errors, /references unknown source unknown/);
    assert.match(errors, /type string does not match result type number/);
    assert.match(errors, /missing script content/);
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

test("preflightWorkflowFile rejects unsafe file and archive paths", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-"));
  const outsideFile = join(tmpdir(), `outside-${Date.now()}.workflow`);
  await writeFile(outsideFile, buildWorkflowArtifact(workflow));
  await symlink(outsideFile, join(workflowDir, "linked.workflow"));
  await writeFile(
    join(workflowDir, "unsafe.workflow"),
    zipSync({
      "../workflow-content": utf16LeWithBom("<workflow />"),
      "workflow-info": new TextEncoder().encode("<workflow-info />"),
    }),
  );

  try {
    const traversal = await preflightWorkflowFile(workflowDir, "../x.workflow");
    assert.equal(traversal.valid, false);
    assert.match(traversal.errors.join("\n"), /path separators/);

    const linked = await preflightWorkflowFile(workflowDir, "linked.workflow");
    assert.equal(linked.valid, false);
    assert.match(linked.errors.join("\n"), /symbolic link/);

    const unsafe = await preflightWorkflowFile(workflowDir, "unsafe.workflow");
    assert.equal(unsafe.valid, false);
    assert.match(unsafe.errors.join("\n"), /escapes the archive root/);
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
});

test("preflightPackageFile summarizes nested recognizable artifacts", async () => {
  const packageDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-packages-"));
  await writeFile(
    join(packageDir, "bundle.package"),
    zipSync({
      "workflows/generated.workflow": buildWorkflowArtifact(workflow),
      "manifest.xml": new TextEncoder().encode("<package />"),
    }),
  );

  try {
    const report = await preflightPackageFile(packageDir, "bundle.package");
    assert.equal(report.valid, true);
    assert.equal(report.metadata.workflowArtifacts, 1);
    assert.equal(report.metadata.actionArtifacts, 0);
    assert.equal(report.metadata.configurationArtifacts, 0);
    assert.equal(report.parameters.length, 2);
  } finally {
    await rm(packageDir, { recursive: true, force: true });
  }
});

test("diffWorkflowArtifacts reports identical local workflow artifacts", () => {
  const model = inspectWorkflowArtifactBuffer(
    buildWorkflowArtifact(workflow),
    "generated.workflow",
  );

  assert.equal(
    diffWorkflowArtifacts(model, model),
    "No meaningful workflow changes found",
  );
});

test("diffWorkflowArtifacts reports parameter and attribute changes", () => {
  const base = inspectWorkflowArtifactBuffer(buildWorkflowArtifact({
    ...workflow,
    attributes: [{ name: "enabled", type: "boolean" }],
  }));
  const compare = inspectWorkflowArtifactBuffer(buildWorkflowArtifact({
    ...workflow,
    inputs: [{ name: "message", type: "string" }, { name: "count", type: "number" }],
    attributes: [{ name: "enabled", type: "string" }],
  }));

  const diff = diffWorkflowArtifacts(base, compare);
  assert.match(diff, /Inputs changes/);
  assert.match(diff, /Added parameter count/);
  assert.match(diff, /Attributes changes/);
  assert.match(diff, /Changed parameter enabled/);
});

test("diffWorkflowArtifacts reports script and action-reference changes", () => {
  const base = inspectWorkflowArtifactBuffer(buildWorkflowArtifact(workflow));
  const compare = inspectWorkflowArtifactBuffer(buildWorkflowArtifact({
    ...workflow,
    tasks: [{
      ...workflow.tasks[0],
      script: 'result = System.getModule("com.example.actions").upper(message);',
    }],
  }));

  const diff = diffWorkflowArtifacts(base, compare);
  assert.match(diff, /script changed/);
  assert.match(diff, /Added action reference com.example.actions\/upper/);
  assert.match(diff, /Removed action reference com.example.actions\/echo/);
});

test("diffWorkflowArtifacts reports binding and flow changes", () => {
  const base = inspectWorkflowArtifactBuffer(buildWorkflowArtifact({
    ...workflow,
    attributes: [{ name: "scratch", type: "string" }],
    tasks: [{
      ...workflow.tasks[0],
      outBindings: [{ name: "result", type: "string", target: "result" }],
    }],
  }));
  const compare = inspectWorkflowArtifactBuffer(buildWorkflowArtifact({
    ...workflow,
    attributes: [{ name: "scratch", type: "string" }],
    tasks: [{
      ...workflow.tasks[0],
      outBindings: [{ name: "scratch", type: "string", target: "scratch" }],
    }],
  }));

  const diff = diffWorkflowArtifacts(base, compare);
  assert.match(diff, /output binding result/);
  assert.match(diff, /Removed output binding result/);
  assert.match(diff, /Added output binding scratch/);

  const flowBase = inspectWorkflowArtifactBuffer(workflowArchiveWithFlow("item2"));
  const flowCompare = inspectWorkflowArtifactBuffer(workflowArchiveWithFlow("item3"));
  assert.match(diffWorkflowArtifacts(flowBase, flowCompare), /outName: "item2" -> "item3"/);
});

test("diffWorkflowArtifacts reports task add and remove", () => {
  const base = inspectWorkflowArtifactBuffer(buildWorkflowArtifact(workflow));
  const compare = inspectWorkflowArtifactBuffer(buildWorkflowArtifact({
    ...workflow,
    tasks: [
      workflow.tasks[0],
      { name: "item2", script: "System.log('next');" },
    ],
  }));

  const diff = diffWorkflowArtifacts(base, compare);
  assert.match(diff, /Added task item2/);
});

test("diffActionArtifacts reports identical action artifacts", () => {
  const model = inspectActionArtifactBuffer(actionArchive());

  assert.equal(
    diffActionArtifacts(model, model),
    "No meaningful action changes found",
  );
});

test("diffActionArtifacts reports metadata changes", () => {
  const base = inspectActionArtifactBuffer(actionArchive());
  const compare = inspectActionArtifactBuffer(actionArchive({
    name: "upper",
    module: "com.example.changed",
    returnType: "number",
  }));

  const diff = diffActionArtifacts(base, compare);
  assert.match(diff, /Metadata changes/);
  assert.match(diff, /name: "echo" -> "upper"/);
  assert.match(diff, /module: "com.example.actions" -> "com.example.changed"/);
  assert.match(diff, /returnType: "string" -> "number"/);
});

test("diffActionArtifacts reports input parameter changes", () => {
  const base = inspectActionArtifactBuffer(actionArchive({
    inputParameters: [
      { name: "message", type: "string", description: "Message" },
      { name: "removeMe", type: "number", description: "Old" },
    ],
  }));
  const compare = inspectActionArtifactBuffer(actionArchive({
    inputParameters: [
      { name: "message", type: "number", description: "Count" },
      { name: "enabled", type: "boolean", description: "Enabled" },
    ],
  }));

  const diff = diffActionArtifacts(base, compare);
  assert.match(diff, /Input parameter changes/);
  assert.match(diff, /Added parameter enabled/);
  assert.match(diff, /Removed parameter removeMe/);
  assert.match(diff, /Changed parameter message/);
  assert.match(diff, /"type":"string"/);
  assert.match(diff, /"description":"Count"/);
});

test("diffActionArtifacts reports script and action-reference changes", () => {
  const base = inspectActionArtifactBuffer(actionArchive({
    script: 'return System.getModule("com.example.actions").echo(message);',
  }));
  const compare = inspectActionArtifactBuffer(actionArchive({
    script: 'return System.getModule("com.example.actions").upper(message);',
  }));

  const diff = diffActionArtifacts(base, compare);
  assert.match(diff, /Script changes/);
  assert.match(diff, /script changed/);
  assert.match(diff, /sha256:/);
  assert.match(diff, /Added action reference com.example.actions\/upper/);
  assert.match(diff, /Removed action reference com.example.actions\/echo/);
});

test("diffActionFile compares local action artifacts and rejects unsafe sources", async () => {
  const actionDir = await mkdtemp(join(tmpdir(), "vcfa-actions-"));
  const outsideFile = join(tmpdir(), `outside-${Date.now()}.action`);
  await writeFile(join(actionDir, "base.action"), actionArchive());
  await writeFile(join(actionDir, "compare.action"), actionArchive({ name: "upper" }));
  await writeFile(outsideFile, actionArchive());
  await symlink(outsideFile, join(actionDir, "linked.action"));
  await writeFile(join(actionDir, "bad.action"), "not a zip");

  try {
    const client = new VroClient(config({ actionDir }));
    const diff = await client.diffActionFile({
      base: { source: "file", fileName: "base.action" },
      compare: { source: "file", fileName: "compare.action" },
    });
    assert.match(diff, /name: "echo" -> "upper"/);

    await assert.rejects(
      () => client.diffActionFile({
        base: { source: "file", fileName: "../base.action" },
        compare: { source: "file", fileName: "compare.action" },
      }),
      /path separators/,
    );
    await assert.rejects(
      () => client.diffActionFile({
        base: { source: "file", fileName: "linked.action" },
        compare: { source: "file", fileName: "compare.action" },
      }),
      /symbolic link/,
    );
    await assert.rejects(
      () => client.diffActionFile({
        base: { source: "file", fileName: "bad.action" },
        compare: { source: "file", fileName: "compare.action" },
      }),
      /valid ZIP archive/,
    );

    const report = await preflightActionFile(actionDir, "linked.action");
    assert.equal(report.valid, false);
    assert.match(report.errors.join("\n"), /symbolic link/);
  } finally {
    await rm(actionDir, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  }
});

test("malformed imports fail preflight before authentication or upload", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-import-"));
  await writeFile(join(workflowDir, "bad.workflow"), "not a zip");
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response("", { status: 500 });
  };

  try {
    const client = new VroClient(config({ workflowDir }));
    await assert.rejects(
      () => client.importWorkflowFile("category-1", "bad.workflow"),
      /preflight failed[\s\S]*valid ZIP archive/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

function utf16LeWithBom(value) {
  return new Uint8Array([0xff, 0xfe, ...Buffer.from(value, "utf16le")]);
}

function workflowArchiveWithFlow(outName) {
  const xml = [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<workflow id="workflow-1" root-name="item1">',
    "  <input />",
    "  <output />",
    "  <attrib />",
    `  <workflow-item name="item1" type="task" out-name="${outName}">`,
    "    <in-binding />",
    "    <out-binding />",
    "    <script>System.log('one');</script>",
    "  </workflow-item>",
    `  <workflow-item name="${outName}" type="task" end-mode="1">`,
    "    <in-binding />",
    "    <out-binding />",
    "    <script>System.log('two');</script>",
    "  </workflow-item>",
    "</workflow>",
  ].join("\n");
  return zipSync({
    "workflow-info": new TextEncoder().encode(
      '<workflow-info id="workflow-1" name="Flow" />',
    ),
    "workflow-content": utf16LeWithBom(xml),
  });
}

function actionArchive(overrides = {}) {
  const action = {
    id: "action-1",
    name: "echo",
    module: "com.example.actions",
    fqn: "com.example.actions.echo",
    version: "1.0.0",
    returnType: "string",
    description: "Echo a message",
    inputParameters: [
      { name: "message", type: "string", description: "Message" },
    ],
    script: 'return System.getModule("com.example.actions").echo(message);',
    ...overrides,
  };
  const params = action.inputParameters
    .map(
      (param) =>
        `<param name="${escapeXml(param.name)}" type="${escapeXml(param.type)}"><description>${escapeXml(param.description ?? "")}</description></param>`,
    )
    .join("");
  const xml = [
    `<action id="${escapeXml(action.id)}" name="${escapeXml(action.name)}" module="${escapeXml(action.module)}" fqn="${escapeXml(action.fqn)}" version="${escapeXml(action.version)}" output-type="${escapeXml(action.returnType)}">`,
    `<description>${escapeXml(action.description)}</description>`,
    `<input-parameters>${params}</input-parameters>`,
    `<script><![CDATA[${action.script}]]></script>`,
    "</action>",
  ].join("");
  return zipSync({
    "action.xml": new TextEncoder().encode(xml),
  });
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
