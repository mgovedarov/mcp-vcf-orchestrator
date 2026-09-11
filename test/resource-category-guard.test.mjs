import assert from "node:assert/strict";
import test from "node:test";
import { registerResourceTools } from "../dist/tools/resource-tools.js";

// vRO 8.18.1 answers GET /resources with only description/id/name/version per
// element — no categoryName (verified on the wire, VCFO-077). Feeding that
// absence into the generic field guard reported every expectedCategoryName as a
// mismatch against "(missing)", so supplying the argument refused a legitimate
// update or delete no matter what the caller passed.

function registeredTools(client) {
  const handlers = new Map();
  register(handlers, client);
  return handlers;
}

function register(handlers, client) {
  registerResourceTools(
    {
      registerTool(name, _config, handler) {
        handlers.set(name, handler);
      },
    },
    client,
  );
}

function clientWith(element, sink) {
  return {
    getResourceElement: async () => element,
    updateResourceContent: async (id, fileName) => {
      sink.updated = { id, fileName };
    },
    deleteResource: async (id) => {
      sink.deleted = { id };
    },
    getResourceDirectory: () => "/tmp/resources",
  };
}

for (const tool of ["update-resource-element", "delete-resource-element"]) {
  test(`${tool} refuses expectedCategoryName when the element carries no category`, async () => {
    const sink = {};
    const handlers = registeredTools(
      clientWith({ id: "r1", name: "certificate.gif" }, sink),
    );

    const result = await handlers.get(tool)({
      id: "r1",
      fileName: "certificate.gif",
      expectedName: "certificate.gif",
      expectedCategoryName: "zz-probe",
      confirm: true,
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Cannot verify expectedCategoryName/);
    assert.match(result.content[0].text, /No live mutation was performed/);
    // The old behavior reported a bare mismatch against "(missing)".
    assert.doesNotMatch(result.content[0].text, /found \(missing\)/);
    assert.equal(sink.updated, undefined);
    assert.equal(sink.deleted, undefined);
  });

  test(`${tool} still verifies expectedCategoryName when the element reports one`, async () => {
    const sink = {};
    const handlers = registeredTools(
      clientWith(
        { id: "r1", name: "certificate.gif", categoryName: "Icons" },
        sink,
      ),
    );

    const mismatch = await handlers.get(tool)({
      id: "r1",
      fileName: "certificate.gif",
      expectedCategoryName: "zz-probe",
      confirm: true,
    });
    assert.equal(mismatch.isError, true);
    assert.match(mismatch.content[0].text, /expected "zz-probe", found "Icons"/);
    assert.equal(sink.updated, undefined);
    assert.equal(sink.deleted, undefined);

    await handlers.get(tool)({
      id: "r1",
      fileName: "certificate.gif",
      expectedCategoryName: "Icons",
      confirm: true,
    });
    assert.ok(sink.updated || sink.deleted, "a matching category must proceed");
  });

  test(`${tool} proceeds when expectedCategoryName is omitted`, async () => {
    const sink = {};
    const handlers = registeredTools(
      clientWith({ id: "r1", name: "certificate.gif" }, sink),
    );

    await handlers.get(tool)({
      id: "r1",
      fileName: "certificate.gif",
      expectedName: "certificate.gif",
      confirm: true,
    });

    assert.ok(sink.updated || sink.deleted, "expectedName alone must proceed");
  });

  test(`${tool} reports a name mismatch even when the category is unverifiable`, async () => {
    const sink = {};
    const handlers = registeredTools(
      clientWith({ id: "r1", name: "certificate.gif" }, sink),
    );

    // A wrong target is the more urgent signal: an unverifiable category must
    // not mask it, or the caller drops expectedCategoryName as the message
    // advises and only then discovers the name does not match.
    const result = await handlers.get(tool)({
      id: "r1",
      fileName: "certificate.gif",
      expectedName: "logo.png",
      expectedCategoryName: "zz-probe",
      confirm: true,
    });

    assert.equal(result.isError, true);
    assert.match(
      result.content[0].text,
      /resource name: expected "logo.png", found "certificate.gif"/,
    );
    assert.doesNotMatch(result.content[0].text, /Cannot verify/);
    assert.equal(sink.updated, undefined);
    assert.equal(sink.deleted, undefined);
  });

  test(`${tool} treats an empty category as absent, not as a mismatch`, async () => {
    const sink = {};
    const handlers = registeredTools(
      clientWith({ id: "r1", name: "certificate.gif", categoryName: "" }, sink),
    );

    const result = await handlers.get(tool)({
      id: "r1",
      fileName: "certificate.gif",
      expectedCategoryName: "Icons",
      confirm: true,
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Cannot verify expectedCategoryName/);
    assert.doesNotMatch(result.content[0].text, /found ""/);
    assert.equal(sink.updated, undefined);
    assert.equal(sink.deleted, undefined);
  });
}
