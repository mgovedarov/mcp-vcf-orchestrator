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
  buildWorkflowInputFormJson,
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

test("buildWorkflowContent creates UTF-16BE workflow XML with metadata and bindings", () => {
  const content = buildWorkflowContent(workflow);
  assert.equal(content[0], 0xfe);
  assert.equal(content[1], 0xff);

  const xml = new TextDecoder("utf-16be").decode(content);
  assert.match(xml, /<workflow /);
  assert.match(xml, /id="workflow-1"/);
  assert.match(xml, /version="1\.0\.0"/);
  assert.match(xml, /api-version="6\.0\.0"/);
  // Editable user workflow: lowercase object-name, editor-version, and NO
  // allowed-operations (that flag marks read-only Library workflows and makes
  // the vRO editor refuse to open the workflow).
  assert.match(xml, /object-name="workflow:name=generic"/);
  assert.match(xml, /editor-version="2\.0"/);
  assert.doesNotMatch(xml, /allowed-operations/);
  assert.match(
    xml,
    /<display-name><!\[CDATA\[Provision <VM>\]\]><\/display-name>/,
  );
  assert.match(xml, /<param name="projectName" type="string">/);
  assert.match(xml, /<param name="vmCount" type="number">/);
  assert.match(
    xml,
    /<attrib name="runningTotal" type="number" read-only="false">/,
  );
  assert.match(xml, /<value encoded="n"><!\[CDATA\[__NULL__\]\]><\/value>/);
  assert.match(
    xml,
    /<workflow-item name="item1" type="task" out-name="finish">/,
  );
  // Last task chains to an explicit end item; no end-mode on tasks.
  assert.match(
    xml,
    /<workflow-item name="finish" type="task" out-name="item_end">/,
  );
  assert.doesNotMatch(xml, /type="task"[^>]*end-mode/);
  assert.match(
    xml,
    /<workflow-item name="item_end" type="end" end-mode="0">/,
  );
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
  assert.ok(files["input_form_"]);

  // workflow-info is a Java properties file, not XML; identity lives in content.
  const info = new TextDecoder().decode(files["workflow-info"]);
  assert.match(info, /^type=workflow$/m);
  assert.match(info, /^version=2\.0$/m);
  assert.match(info, /^charset=UTF-16$/m);
  assert.match(info, /^unicode=true$/m);
  assert.match(info, /^creator=www\.dunes\.ch$/m);
  assert.doesNotMatch(info, /</);

  const content = files["workflow-content"];
  assert.equal(content[0], 0xfe);
  assert.equal(content[1], 0xff);
  const xml = new TextDecoder("utf-16be").decode(content);
  assert.match(xml, /<script encoded="false"><!\[CDATA\[/);
  assert.match(xml, /<presentation>/);

  const form = files["input_form_"];
  assert.equal(form[0], 0xfe);
  assert.equal(form[1], 0xff);
  const inputForm = JSON.parse(new TextDecoder("utf-16be").decode(form));
  assert.deepEqual(inputForm.layout.pages[0], {
    id: "page_general",
    sections: [
      {
        id: "section_inputs",
        fields: [
          {
            id: "projectName",
            display: "textField",
            signpostPosition: "right-middle",
            state: { visible: true, "read-only": false },
          },
        ],
      },
    ],
    title: "General",
  });
  assert.deepEqual(inputForm.schema.projectName, {
    id: "projectName",
    type: { dataType: "string" },
    label: "Project",
    constraints: { required: true },
  });
  assert.deepEqual(inputForm.options, { externalValidations: [] });
});

test("buildWorkflowArtifact omits input_form_ when the workflow has no inputs", () => {
  const files = unzipSync(
    buildWorkflowArtifact({
      name: "Inputless",
      tasks: [{ name: "only", script: "x = 1;" }],
    }),
  );

  assert.ok(files["workflow-info"]);
  assert.ok(files["workflow-content"]);
  assert.equal(files["input_form_"], undefined);
});

const actionWorkflow = {
  id: "workflow-action-1",
  name: "Echo Message",
  description: "Wrap the echo action",
  inputs: [{ name: "message", type: "string", description: "Message to echo" }],
  outputs: [{ name: "result", type: "string", description: "Echoed message" }],
  tasks: [
    {
      kind: "action",
      displayName: "Echo",
      module: "com.example.actions",
      actionName: "echo",
      inputs: [{ name: "message", type: "string", source: "message" }],
      resultBinding: { name: "result", type: "string" },
    },
  ],
};

test("buildWorkflowContent renders a native action workflow item", () => {
  const xml = new TextDecoder("utf-16be").decode(
    buildWorkflowContent(actionWorkflow),
  );

  assert.match(
    xml,
    /<workflow-item name="item1" type="task" script-module="com\.example\.actions\/echo" out-name="item_end">/,
  );
  assert.match(
    xml,
    /<bind name="message" type="string" export-name="message" \/>/,
  );
  assert.match(
    xml,
    /<bind name="actionResult" type="string" export-name="result" \/>/,
  );
  assert.match(
    xml,
    /actionResult = System\.getModule\("com\.example\.actions"\)\.echo\(message\);/,
  );
});

test("native action item with no resultBinding omits actionResult and out-binding", () => {
  const xml = new TextDecoder("utf-16be").decode(
    buildWorkflowContent({
      ...actionWorkflow,
      outputs: [],
      tasks: [
        {
          kind: "action",
          displayName: "Log",
          module: "com.example.actions",
          actionName: "logIt",
          inputs: [{ name: "message", type: "string", source: "message" }],
        },
      ],
    }),
  );

  assert.match(
    xml,
    /<workflow-item name="item1" type="task" script-module="com\.example\.actions\/logIt" out-name="item_end">/,
  );
  assert.match(
    xml,
    /System\.getModule\("com\.example\.actions"\)\.logIt\(message\);/,
  );
  assert.doesNotMatch(xml, /actionResult/);
  assert.match(xml, /<out-binding \/>/);
});

test("native action task requires module and actionName", () => {
  assert.throws(
    () =>
      buildWorkflowContentXml({
        name: "Bad action",
        inputs: [],
        outputs: [],
        tasks: [{ kind: "action", displayName: "Broken" }],
      }),
    /missing a module[\s\S]*missing an actionName/,
  );
});

test("native action task rejects malformed module and actionName", () => {
  assert.throws(
    () =>
      buildWorkflowContentXml({
        name: "Bad action",
        inputs: [],
        outputs: [],
        tasks: [
          {
            kind: "action",
            module: "com.example.actions/echo",
            actionName: "echo it",
          },
        ],
      }),
    /module "com.example.actions\/echo" must be a dotted module name[\s\S]*actionName "echo it" must be a valid script identifier/,
  );
});

test("buildWorkflowInputFormJson maps common vRO input types", () => {
  const inputForm = JSON.parse(
    buildWorkflowInputFormJson({
      ...workflow,
      inputs: [
        { name: "vm", type: "VC:VirtualMachine", description: "VM" },
        { name: "enabled", type: "boolean", description: "Enabled" },
        { name: "password", type: "SecureString", description: "Password" },
      ],
      outputs: [],
      attributes: [],
      tasks: [{ script: "System.log('form only');" }],
    }),
  );

  assert.equal(inputForm.schema.vm.type.dataType, "reference");
  assert.equal(inputForm.schema.vm.type.referenceType, "VC:VirtualMachine");
  assert.equal(inputForm.layout.pages[0].sections[0].fields[0].display, "valuePickerTree");
  assert.equal(inputForm.schema.enabled.type.dataType, "boolean");
  assert.equal(inputForm.layout.pages[0].sections[0].fields[1].display, "checkbox");
  assert.equal(inputForm.schema.password.type.dataType, "secureString");
  assert.equal(inputForm.layout.pages[0].sections[0].fields[2].display, "passwordField");
});

test("buildWorkflowArtifact generates a workflow ID in workflow-content", () => {
  const archive = buildWorkflowArtifact({ ...workflow, id: undefined });
  const files = unzipSync(archive);
  const xml = new TextDecoder("utf-16be").decode(files["workflow-content"]);

  const contentId = xml.match(/ id="([^"]+)"/)?.[1];

  assert.match(
    contentId ?? "",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
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
