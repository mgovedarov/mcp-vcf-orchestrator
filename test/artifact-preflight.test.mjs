import { unzipSync, zipSync } from "fflate";
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

const twoInputWorkflow = {
  ...workflow,
  inputs: [
    { name: "message", type: "string" },
    { name: "count", type: "number" },
  ],
  tasks: [
    {
      script: "result = message;",
      inBindings: [
        { name: "message", type: "string", source: "message" },
        { name: "count", type: "number", source: "count" },
      ],
      outBindings: [{ name: "result", type: "string", target: "result" }],
    },
  ],
};

test("preflightWorkflowFile flags input_form_ fields that do not match a workflow input", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-"));
  await writeFile(
    join(workflowDir, "stale.workflow"),
    workflowArtifactWithForm(workflow, inputFormFor([{ id: "wrongName" }])),
  );

  try {
    const report = await preflightWorkflowFile(workflowDir, "stale.workflow");
    assert.equal(report.valid, false);
    assert.match(
      report.errors.join("\n"),
      /schema\.wrongName does not match any declared workflow input/,
    );
    assert.match(
      report.warnings.join("\n"),
      /no field for declared workflow input message/,
    );
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

test("preflightWorkflowFile warns when a workflow input has no input_form_ field", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-"));
  await writeFile(
    join(workflowDir, "partial.workflow"),
    workflowArtifactWithForm(twoInputWorkflow, inputFormFor([{ id: "message" }])),
  );

  try {
    const report = await preflightWorkflowFile(workflowDir, "partial.workflow");
    assert.equal(report.valid, true);
    assert.match(
      report.warnings.join("\n"),
      /no field for declared workflow input count/,
    );
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

test("preflightWorkflowFile warns when an input_form_ dataType disagrees with the workflow input", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-"));
  await writeFile(
    join(workflowDir, "mismatch.workflow"),
    workflowArtifactWithForm(
      workflow,
      inputFormFor([{ id: "message", dataType: "boolean", display: "checkbox" }]),
    ),
  );

  try {
    const report = await preflightWorkflowFile(workflowDir, "mismatch.workflow");
    assert.equal(report.valid, true);
    assert.match(
      report.warnings.join("\n"),
      /schema\.message type\.dataType "boolean" does not match workflow input message \(string -> string\)/,
    );
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

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
    assert.match(report.metadata["display-name"], /Generated Workflow/);
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

const nativeActionWorkflow = {
  id: "wf-native-1",
  name: "Echo Wrapper",
  inputs: [{ name: "message", type: "string" }],
  outputs: [{ name: "result", type: "string" }],
  tasks: [
    {
      kind: "action",
      module: "com.example.actions",
      actionName: "echo",
      inputs: [{ name: "message", type: "string", source: "message" }],
      resultBinding: { name: "result", type: "string" },
    },
  ],
};

test("preflightWorkflowFile recognizes native action workflow items", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-"));
  await writeFile(
    join(workflowDir, "native-action.workflow"),
    buildWorkflowArtifact(nativeActionWorkflow),
  );

  try {
    const report = await preflightWorkflowFile(
      workflowDir,
      "native-action.workflow",
    );

    assert.equal(report.valid, true);
    assert.equal(report.errors.length, 0);
    assert.match(
      report.metadata["native-action-items"],
      /item1 -> com\.example\.actions\/echo/,
    );
    assert.deepEqual(report.actionReferences, [
      {
        module: "com.example.actions",
        action: "echo",
        expression: 'System.getModule("com.example.actions").echo(',
      },
    ]);
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

function nativeActionContentXml(scriptModule) {
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<workflow id="workflow-1" root-name="item1">',
    "  <input>",
    '    <param name="message" type="string" />',
    "  </input>",
    "  <output>",
    '    <param name="result" type="string" />',
    "  </output>",
    `  <workflow-item name="item1" type="task" script-module="${scriptModule}" out-name="end0">`,
    '    <in-binding><bind name="message" type="string" export-name="message" /></in-binding>',
    '    <out-binding><bind name="actionResult" type="string" export-name="result" /></out-binding>',
    '    <script>actionResult = System.getModule("com.example.actions").echo(message);</script>',
    "  </workflow-item>",
    '  <workflow-item name="end0" type="end" end-mode="0" />',
    "</workflow>",
  ].join("\n");
}

test("preflightWorkflowFile rejects malformed native action script-module values", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-"));
  // The scaffold cannot emit these; the branch guards hand-authored/exported XML.
  for (const [fileName, scriptModule] of [
    ["extra-segment.workflow", "com.example.actions/echo/extra"],
    ["trailing-slash.workflow", "com.example.actions/"],
  ]) {
    await writeFile(
      join(workflowDir, fileName),
      zipSync({
        "workflow-info": propertiesInfo(),
        "workflow-content": utf16BeWithBom(nativeActionContentXml(scriptModule)),
      }),
    );
  }

  try {
    for (const [fileName, scriptModule] of [
      ["extra-segment.workflow", "com.example.actions/echo/extra"],
      ["trailing-slash.workflow", "com.example.actions/"],
    ]) {
      const report = await preflightWorkflowFile(workflowDir, fileName);
      assert.equal(report.valid, false);
      assert.match(
        report.errors.join("\n"),
        new RegExp(
          `invalid script-module "${scriptModule.replace(/[.\\/]/g, "\\$&")}"`,
        ),
      );
      assert.equal(report.metadata["native-action-items"], undefined);
    }
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
      "workflow-info": propertiesInfo(),
    }),
  );
  await writeFile(
    join(workflowDir, "utf8.workflow"),
    zipSync({
      "workflow-info": propertiesInfo(),
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
      "workflow-info": propertiesInfo(),
      "workflow-content": utf16BeWithBom(malformedXml),
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
    assert.match(utf8.errors.join("\n"), /UTF-16BE XML with a BOM/);

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
      "workflow-info": propertiesInfo(),
      "workflow-content": utf16BeWithBom(invalidXml),
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

test("preflightWorkflowFile rejects the legacy scaffold container format", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-"));
  // Pre-VCFO-060 scaffold: XML workflow-info + UTF-16LE workflow-content.
  const legacyXml = [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<workflow id="wf-legacy" root-name="item0">',
    "  <input /><output /><attrib />",
    '  <workflow-item name="item0" type="task" end-mode="1">',
    "    <in-binding /><out-binding />",
    "    <script>System.log('x');</script>",
    "  </workflow-item>",
    "</workflow>",
  ].join("\n");
  await writeFile(
    join(workflowDir, "legacy.workflow"),
    zipSync({
      "workflow-info": new TextEncoder().encode(
        '<workflow-info id="wf-legacy" name="Legacy" />',
      ),
      "workflow-content": utf16LeWithBom(legacyXml),
    }),
  );
  // Properties info + BE content, but the terminal task still uses end-mode="1"
  // instead of an explicit end item — should be flagged once it parses.
  await writeFile(
    join(workflowDir, "legacy-end.workflow"),
    zipSync({
      "workflow-info": propertiesInfo(),
      "workflow-content": utf16BeWithBom(legacyXml),
    }),
  );

  try {
    const legacy = await preflightWorkflowFile(workflowDir, "legacy.workflow");
    assert.equal(legacy.valid, false);
    const legacyErrors = legacy.errors.join("\n");
    assert.match(legacyErrors, /workflow-info must be a Java properties file/);
    assert.match(legacyErrors, /must be UTF-16BE.*found a UTF-16LE BOM/);

    const legacyEnd = await preflightWorkflowFile(
      workflowDir,
      "legacy-end.workflow",
    );
    assert.equal(legacyEnd.valid, false);
    const endErrors = legacyEnd.errors.join("\n");
    assert.match(endErrors, /unsupported end-mode attribute/);
    assert.match(endErrors, /no terminal item/);
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

test("preflightWorkflowFile accepts a real-export-shaped workflow container", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-"));
  // Mirrors vRO's own export: properties workflow-info, UTF-16BE content,
  // explicit type="end" item, and no input_form_ entry.
  const exportXml = [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<workflow xmlns="http://vmware.com/vco/workflow" root-name="item0" object-name="Workflow:name=generic" id="wf-export-1" version="1.0.0" api-version="6.0.0" allowed-operations="vf">',
    "  <display-name><![CDATA[Export Shaped]]></display-name>",
    '  <input><param name="message" type="string" /></input>',
    '  <output><param name="result" type="string" /></output>',
    "  <attrib />",
    '  <workflow-item name="item0" type="task" out-name="end0">',
    '    <in-binding><bind name="message" type="string" export-name="message" /></in-binding>',
    '    <out-binding><bind name="result" type="string" export-name="result" /></out-binding>',
    "    <script>result = message;</script>",
    "  </workflow-item>",
    '  <workflow-item name="end0" type="end" end-mode="0"><position y="0.0" x="0.0" /></workflow-item>',
    "</workflow>",
  ].join("\n");
  await writeFile(
    join(workflowDir, "export.workflow"),
    zipSync({
      "workflow-info": propertiesInfo(),
      "workflow-content": utf16BeWithBom(exportXml),
    }),
  );

  try {
    const report = await preflightWorkflowFile(workflowDir, "export.workflow");
    assert.equal(report.errors.join("\n"), "");
    assert.equal(report.valid, true);
    assert.match(report.metadata["display-name"], /Export Shaped/);
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

test("preflightWorkflowFile accepts vRO attribute and Any binding shapes", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-"));
  // Mirrors the createSnapshot reference export: attributes as repeated
  // top-level <attrib name type> elements (referenced by item bindings), and a
  // generic action returning type="Any" bound to a concretely typed output.
  const exportXml = [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<workflow xmlns="http://vmware.com/vco/workflow" root-name="item0" object-name="Workflow:name=generic" id="wf-attr-1" version="1.0.0" api-version="6.0.0" allowed-operations="vf">',
    "  <display-name><![CDATA[Attr Export Shaped]]></display-name>",
    '  <input><param name="vm" type="VC:VirtualMachine" /></input>',
    '  <output><param name="snapshot" type="VC:VirtualMachineSnapshot" /></output>',
    '  <attrib name="task" type="VC:Task" read-only="false"><value encoded="n"><![CDATA[__NULL__]]></value></attrib>',
    '  <attrib name="progress" type="boolean" read-only="false"><value encoded="n"><![CDATA[false]]></value></attrib>',
    '  <workflow-item name="item0" out-name="item1" type="task" script-module="com.vmware.library.vc.vm.snapshot/createSnapshot">',
    '    <in-binding><bind name="vm" type="VC:VirtualMachine" export-name="vm" /></in-binding>',
    '    <out-binding><bind name="actionResult" type="VC:Task" export-name="task" /></out-binding>',
    "    <script>actionResult = System.getModule(&quot;com.vmware.library.vc.vm.snapshot&quot;).createSnapshot(vm);</script>",
    "  </workflow-item>",
    '  <workflow-item name="item1" out-name="end0" type="task" script-module="com.vmware.library.vc.basic/vim3WaitTaskEnd">',
    "    <in-binding>",
    '      <bind name="task" type="VC:Task" export-name="task" />',
    '      <bind name="progress" type="boolean" export-name="progress" />',
    "    </in-binding>",
    '    <out-binding><bind name="actionResult" type="Any" export-name="snapshot" /></out-binding>',
    "    <script>actionResult = System.getModule(&quot;com.vmware.library.vc.basic&quot;).vim3WaitTaskEnd(task,progress);</script>",
    "  </workflow-item>",
    '  <workflow-item name="end0" type="end" end-mode="0" />',
    "</workflow>",
  ].join("\n");
  await writeFile(
    join(workflowDir, "attr-export.workflow"),
    zipSync({
      "workflow-info": propertiesInfo(),
      "workflow-content": utf16BeWithBom(exportXml),
    }),
  );

  try {
    const report = await preflightWorkflowFile(
      workflowDir,
      "attr-export.workflow",
    );
    assert.equal(report.errors.join("\n"), "");
    assert.equal(report.valid, true);
    // Attributes parsed from the repeated <attrib> shape are reported.
    const attrs = report.parameters
      .filter((p) => p.scope === "attribute")
      .map((p) => p.name)
      .sort();
    assert.deepEqual(attrs, ["progress", "task"]);
  } finally {
    await rm(workflowDir, { recursive: true, force: true });
  }
});

test("preflightWorkflowFile warns about editor-incompatible shapes that still import", async () => {
  const workflowDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-"));
  // Imports and runs, but the VCF 9.x editor would 500 on opening it:
  // encoding="UTF-16" declaration, a <param> description child, no item
  // positions, an empty task description, and an end item with no in-binding.
  const xml = [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<workflow xmlns="http://vmware.com/vco/workflow" root-name="step" object-name="workflow:name=generic" id="wf-warn-1" version="1.0.0" api-version="6.0.0">',
    "  <display-name><![CDATA[Warn WF]]></display-name>",
    '  <input><param name="message" type="string"><description><![CDATA[Msg]]></description></param></input>',
    '  <output><param name="result" type="string" /></output>',
    '  <workflow-item name="step" type="task" out-name="end0">',
    '    <in-binding><bind name="message" type="string" export-name="message" /></in-binding>',
    '    <out-binding><bind name="result" type="string" export-name="result" /></out-binding>',
    "    <script>result = message;</script>",
    "  </workflow-item>",
    '  <workflow-item name="end0" type="end" end-mode="0" />',
    "</workflow>",
  ].join("\n");
  await writeFile(
    join(workflowDir, "warn.workflow"),
    zipSync({
      "workflow-info": propertiesInfo(),
      "workflow-content": utf16BeWithBom(xml),
    }),
  );

  try {
    const report = await preflightWorkflowFile(workflowDir, "warn.workflow");
    // Editor-incompatibility is advisory: import/run still work, so it stays valid.
    assert.equal(report.valid, true);
    const warnings = report.warnings.join("\n");
    assert.match(warnings, /declaration uses encoding="UTF-16"/);
    assert.match(warnings, /input parameter message has a <description> child/);
    assert.match(warnings, /item step has no <position>/);
    assert.match(warnings, /End item end0 is missing an <in-binding\/>/);
    assert.match(warnings, /Task step has no <description>/);
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
    assert.equal(report.metadata.inputForms, 1);
    assert.equal(report.parameters.length, 2);
  } finally {
    await rm(packageDir, { recursive: true, force: true });
  }
});

test("preflightPackageFile rejects package input forms with invalid section fields", async () => {
  const packageDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-packages-"));
  const invalidInputForm = {
    layout: {
      pages: [
        {
          id: "page_general",
          sections: [
            {
              id: "section_inputs",
              title: "Inputs",
              fields: [
                {
                  id: "message",
                  display: "value",
                  size: 1,
                  state: { visible: true, "read-only": false },
                },
              ],
            },
          ],
          title: "General",
        },
      ],
    },
    schema: {
      message: {
        id: "message",
        type: { dataType: "string" },
        label: "Message",
      },
    },
    itemId: "",
  };
  await writeFile(
    join(packageDir, "invalid-form.package"),
    zipSync({
      "elements/workflow-1/input_form_": utf16BeWithBom(JSON.stringify(invalidInputForm)),
      "manifest.xml": new TextEncoder().encode("<package />"),
    }),
  );

  try {
    const report = await preflightPackageFile(packageDir, "invalid-form.package");
    assert.equal(report.valid, false);
    assert.match(
      report.errors.join("\n"),
      /sections\/0 must not have additional property title/,
    );
    assert.match(
      report.errors.join("\n"),
      /fields\/0 must not have additional property size/,
    );
  } finally {
    await rm(packageDir, { recursive: true, force: true });
  }
});

test("preflightPackageFile rejects input_form_ entries that are not UTF-16BE", async () => {
  const packageDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-packages-"));
  const form = {
    layout: { pages: [] },
    schema: {},
    options: { externalValidations: [] },
  };
  await writeFile(
    join(packageDir, "le-form.package"),
    zipSync({
      "elements/workflow-1/input_form_": utf16LeWithBom(JSON.stringify(form)),
      "manifest.xml": new TextEncoder().encode("<package />"),
    }),
  );

  try {
    const report = await preflightPackageFile(packageDir, "le-form.package");
    assert.equal(report.valid, false);
    assert.match(
      report.errors.join("\n"),
      /input_form_.*must be UTF-16BE.*found a UTF-16LE BOM/,
    );
  } finally {
    await rm(packageDir, { recursive: true, force: true });
  }
});

test("preflightPackageFile rejects corrupt UTF-16 bytes in input_form_", async () => {
  const packageDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-packages-"));
  // BE BOM + "{" + unpaired high surrogate (U+D800): fatal utf-16be decode throws.
  const corrupt = new Uint8Array([0xfe, 0xff, 0x00, 0x7b, 0xd8, 0x00]);
  await writeFile(
    join(packageDir, "corrupt-form.package"),
    zipSync({
      "elements/workflow-1/input_form_": corrupt,
      "manifest.xml": new TextEncoder().encode("<package />"),
    }),
  );

  try {
    const report = await preflightPackageFile(
      packageDir,
      "corrupt-form.package",
    );
    assert.equal(report.valid, false);
    assert.match(report.errors.join("\n"), /not valid utf-16be/);
  } finally {
    await rm(packageDir, { recursive: true, force: true });
  }
});

test("preflightActionFile fails XML-looking entries with corrupt bytes and still skips binary entries", async () => {
  const actionDir = await mkdtemp(join(tmpdir(), "vcfa-preflight-actions-"));
  // "<a" followed by an invalid UTF-8 continuation sequence.
  const corruptXml = new Uint8Array([0x3c, 0x61, 0xc3, 0x28]);
  // Binary blob that does not decode to something starting with "<".
  const binaryBlob = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xc3, 0x28]);
  await writeFile(
    join(actionDir, "corrupt.action"),
    zipSync({ "action.xml": corruptXml }),
  );
  const validXml = new TextEncoder().encode(
    '<action id="action-1" name="echo" module="com.example.actions" fqn="com.example.actions.echo" version="1.0.0" output-type="string"><description>Echo</description><input-parameters></input-parameters><script><![CDATA[return message;]]></script></action>',
  );
  await writeFile(
    join(actionDir, "binary-ok.action"),
    zipSync({ "action.xml": validXml, "signature.bin": binaryBlob }),
  );

  try {
    const corrupt = await preflightActionFile(actionDir, "corrupt.action");
    assert.equal(corrupt.valid, false);
    assert.match(
      corrupt.errors.join("\n"),
      /action\.xml looks like XML but is not valid utf-8/,
    );

    const binaryOk = await preflightActionFile(actionDir, "binary-ok.action");
    assert.equal(binaryOk.valid, true);
    assert.equal(binaryOk.errors.length, 0);
  } finally {
    await rm(actionDir, { recursive: true, force: true });
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

test("diffWorkflowArtifacts surfaces native action module changes", () => {
  const base = inspectWorkflowArtifactBuffer(
    buildWorkflowArtifact(nativeActionWorkflow),
  );
  const compare = inspectWorkflowArtifactBuffer(
    buildWorkflowArtifact({
      ...nativeActionWorkflow,
      tasks: [{ ...nativeActionWorkflow.tasks[0], actionName: "upper" }],
    }),
  );

  const diff = diffWorkflowArtifacts(base, compare);
  assert.match(
    diff,
    /scriptModule: "com.example.actions\/echo" -> "com.example.actions\/upper"/,
  );
});

test("diffWorkflowArtifacts labels added native action items distinctly", () => {
  const base = inspectWorkflowArtifactBuffer(buildWorkflowArtifact(workflow));
  const compare = inspectWorkflowArtifactBuffer(
    buildWorkflowArtifact({
      ...workflow,
      tasks: [workflow.tasks[0], { ...nativeActionWorkflow.tasks[0], name: "item2" }],
    }),
  );

  const diff = diffWorkflowArtifacts(base, compare);
  assert.match(
    diff,
    /Added task item2 \(native action com\.example\.actions\/echo\)/,
  );
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

function propertiesInfo() {
  return new TextEncoder().encode(
    "#\nowner=\ncharset=UTF-16\ncreator=www.dunes.ch\nunicode=true\ntype=workflow\nversion=2.0\n",
  );
}

function inputFormFor(fields) {
  return {
    layout: {
      pages: [
        {
          id: "page_general",
          sections: [
            {
              id: "section_inputs",
              fields: fields.map((field) => ({
                id: field.id,
                display: field.display ?? "textField",
                signpostPosition: "right-middle",
                state: { visible: true, "read-only": false },
              })),
            },
          ],
          title: "General",
        },
      ],
    },
    schema: Object.fromEntries(
      fields.map((field) => [
        field.id,
        {
          id: field.id,
          type: { dataType: field.dataType ?? "string" },
          label: field.id,
        },
      ]),
    ),
    options: { externalValidations: [] },
    itemId: "",
  };
}

// Builds a valid workflow artifact, then swaps in a hand-crafted input_form_ so
// the preflight cross-check can be exercised against mismatched forms.
function workflowArtifactWithForm(spec, form) {
  const files = unzipSync(buildWorkflowArtifact(spec));
  files["input_form_"] = utf16BeWithBom(JSON.stringify(form));
  return zipSync(files);
}

function utf16LeWithBom(value) {
  return new Uint8Array([0xff, 0xfe, ...Buffer.from(value, "utf16le")]);
}

function utf16BeWithBom(value) {
  const littleEndian = Buffer.from(value, "utf16le");
  for (let index = 0; index < littleEndian.length; index += 2) {
    const first = littleEndian[index];
    littleEndian[index] = littleEndian[index + 1] ?? 0;
    littleEndian[index + 1] = first;
  }
  return new Uint8Array([0xfe, 0xff, ...littleEndian]);
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
    `  <workflow-item name="${outName}" type="task" out-name="end0">`,
    "    <in-binding />",
    "    <out-binding />",
    "    <script>System.log('two');</script>",
    "  </workflow-item>",
    '  <workflow-item name="end0" type="end" end-mode="0" />',
    "</workflow>",
  ].join("\n");
  return zipSync({
    "workflow-info": propertiesInfo(),
    "workflow-content": utf16BeWithBom(xml),
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
