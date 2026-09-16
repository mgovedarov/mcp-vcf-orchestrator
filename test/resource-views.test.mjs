import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  actionResourceView,
  configurationResourceView,
  deploymentResourceView,
  subscriptionResourceView,
} from "../dist/resource-views.js";
import { contentMetadata } from "../dist/content-metadata.js";

const sha = (value) => createHash("sha256").update(value).digest("hex");

test("actionResourceView summarizes the script instead of serving it", () => {
  const script = "var creds = 'hunter2-should-never-render';";
  const view = actionResourceView({
    id: "a-1",
    name: "getVmIp",
    module: "com.example.actions",
    script,
  });

  assert.deepEqual(view.script, {
    included: false,
    sha256: sha(script),
    length: script.length,
  });
  assert.doesNotMatch(JSON.stringify(view), /hunter2/);
  // Everything that is not the script survives.
  assert.equal(view.name, "getVmIp");
  assert.equal(view.module, "com.example.actions");
});

test("actionResourceView leaves a scriptless action without a script key", () => {
  const view = actionResourceView({ id: "a-1", name: "noScript", module: "m" });
  // A field the platform never served must stay absent rather than gain a
  // summary of nothing.
  assert.equal("script" in view, false);
});

test("subscriptionResourceView summarizes constraints the way get-subscription does", () => {
  const constraints = { projectId: "p-1", secretThing: "must-not-render" };
  const view = subscriptionResourceView({
    id: "s-1",
    name: "sub1",
    eventTopicId: "compute.allocation.pre",
    constraints,
  });

  // The tool hashes JSON.stringify(constraints, null, 2); matching that exactly
  // is what lets a caller compare a resource read against a tool result.
  assert.equal(view.constraints.sha256, sha(JSON.stringify(constraints, null, 2)));
  assert.equal(view.constraints.included, false);
  assert.doesNotMatch(JSON.stringify(view), /must-not-render/);
  assert.equal(view.eventTopicId, "compute.allocation.pre");
});

test("subscriptionResourceView leaves an unconstrained subscription alone", () => {
  const view = subscriptionResourceView({ id: "s-1", name: "sub1" });
  assert.equal("constraints" in view, false);
});

test("configurationResourceView withholds a value the server declares secure", () => {
  const view = configurationResourceView({
    id: "c-1",
    name: "cfg1",
    attributes: [
      { name: "plain", type: "string", value: { string: { value: "visible" } } },
      {
        name: "pw",
        type: "SecureString",
        value: { string: { value: "secure-must-not-render" } },
      },
      {
        // Declared permissively but returned in a secure envelope -- the case
        // the declared type alone would miss.
        name: "sneaky",
        type: "Any",
        value: { "secure-string": { value: "envelope-must-not-render" } },
      },
    ],
  });

  assert.doesNotMatch(JSON.stringify(view), /must-not-render/);
  assert.equal(view.attributes[1].value, "[redacted]");
  assert.equal(view.attributes[2].value, "[redacted]");
  // A plain attribute is untouched: the redaction is targeted, and unlike the
  // context snapshot this view does not blank every value.
  assert.deepEqual(view.attributes[0].value, { string: { value: "visible" } });
  assert.equal(view.attributes[1].name, "pw");
  assert.equal(view.attributes[1].type, "SecureString");
});

test("configurationResourceView handles an element with no attributes", () => {
  const view = configurationResourceView({ id: "c-1", name: "cfg1" });
  assert.equal(view.name, "cfg1");
  assert.equal("attributes" in view, false);
});

test("deploymentResourceView withholds credential-named inputs at any depth", () => {
  const view = deploymentResourceView({
    id: "d-1",
    name: "alpine1",
    projectId: "p-1",
    inputs: {
      hostname: "alpine1",
      adminPassword: "must-not-render",
      sshConfig: { user: "root", privateKey: "nested-must-not-render" },
    },
  });

  assert.doesNotMatch(JSON.stringify(view), /must-not-render/);
  assert.equal(view.inputs.adminPassword, "[redacted]");
  assert.equal(view.inputs.sshConfig.privateKey, "[redacted]");
  assert.equal(view.inputs.hostname, "alpine1");
  assert.equal(view.projectId, "p-1");
});

test("contentMetadata is undefined for absent content and stable for present", () => {
  assert.equal(contentMetadata(undefined), undefined);
  // An empty string is content that exists; it must summarize, not vanish.
  assert.deepEqual(contentMetadata(""), {
    included: false,
    sha256: sha(""),
    length: 0,
  });
});
