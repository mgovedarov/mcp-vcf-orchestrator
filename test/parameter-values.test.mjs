import assert from "node:assert/strict";
import test from "node:test";
import {
  fromVroParameterValue,
  toVroParameterValue,
  vroValueEnvelopeKeys,
} from "../dist/client/parameters.js";
import {
  formatExecutionOutputValue,
  formatVroValue,
  formatVroValueRedacted,
  hasVroValue,
} from "../dist/tools/parameter-values.js";

// The envelopes below were read back from a live vRO 8.18.1 configuration
// element (VCFO-080) unless a case says otherwise, so the decoder is pinned to
// the shapes the API actually returns rather than to the ones it accepts.

test("fromVroParameterValue unwraps the scalar envelopes vRO returns", () => {
  assert.equal(
    fromVroParameterValue({ string: { value: "probe-value" } }, "string"),
    "probe-value",
  );
  assert.equal(fromVroParameterValue({ number: { value: 42 } }, "number"), 42);
  assert.equal(
    fromVroParameterValue({ boolean: { value: true } }, "boolean"),
    true,
  );
});

test("fromVroParameterValue unwraps a type key vRO spells differently", () => {
  // A `Date` attribute comes back under the lowercase `date` key, so a lookup
  // by the declared type alone would miss it.
  assert.equal(
    fromVroParameterValue(
      { date: { value: "2026-09-11T10:00:00.000+00:00" } },
      "Date",
    ),
    "2026-09-11T10:00:00.000+00:00",
  );
});

test("fromVroParameterValue keeps falsy scalars instead of dropping them", () => {
  assert.equal(fromVroParameterValue({ string: { value: "" } }, "string"), "");
  assert.equal(fromVroParameterValue({ number: { value: 0 } }, "number"), 0);
  assert.equal(
    fromVroParameterValue({ boolean: { value: false } }, "boolean"),
    false,
  );
});

test("fromVroParameterValue unwraps an array to its element values", () => {
  assert.deepEqual(
    fromVroParameterValue(
      { array: { elements: [{ string: { value: "one" } }] } },
      "Array/string",
    ),
    ["one"],
  );
  // Nested arrays unwrap all the way down.
  assert.deepEqual(
    fromVroParameterValue(
      {
        array: {
          elements: [
            { array: { elements: [{ number: { value: 1 } }] } },
          ],
        },
      },
      "Array/Array/number",
    ),
    [[1]],
  );
});

test("fromVroParameterValue unwraps properties to a plain object", () => {
  // Shape taken from the encoder, not the lab: a Properties attribute cannot be
  // authored through the configuration tools today, so no live sample exists.
  const encoded = toVroParameterValue("Properties", { host: "a", port: 8080 });
  assert.deepEqual(fromVroParameterValue(encoded, "Properties"), {
    host: "a",
    port: 8080,
  });
});

test("fromVroParameterValue returns an SDK object descriptor as-is", () => {
  const descriptor = {
    type: "VC:VirtualMachine",
    href: "https://vro.example.test/vco/api/catalog/VC/VirtualMachine/vm-1/",
    id: "vm-1",
  };
  assert.deepEqual(
    fromVroParameterValue({ "sdk-object": descriptor }, "VC:VirtualMachine"),
    descriptor,
  );
});

test("fromVroParameterValue leaves values it does not recognize untouched", () => {
  // Not an envelope at all.
  assert.equal(fromVroParameterValue("plain", "string"), "plain");
  assert.equal(fromVroParameterValue(undefined, "string"), undefined);
  assert.equal(fromVroParameterValue(null, "string"), null);

  // An inner object without a `value` must not unwrap to undefined.
  const empty = { string: {} };
  assert.deepEqual(fromVroParameterValue(empty, "string"), empty);

  // Several type keys at once: no single envelope to pick, so keep the shape.
  const ambiguous = { string: { value: "a" }, number: { value: 1 } };
  assert.deepEqual(fromVroParameterValue(ambiguous, "unknown-type"), ambiguous);

  // A malformed array envelope keeps its raw shape rather than becoming [].
  const malformed = { array: { elements: "not-a-list" } };
  assert.deepEqual(fromVroParameterValue(malformed, "Array/string"), malformed);

  // Same for a properties envelope that does not carry a property list: the
  // wrapper stays on rather than being silently dropped.
  const collapsed = { properties: { property: { key: "host", value: "a" } } };
  assert.deepEqual(fromVroParameterValue(collapsed, "Properties"), collapsed);
});

test("fromVroParameterValue unwraps an unfamiliar single-key envelope", () => {
  assert.equal(
    fromVroParameterValue({ "mime-attachment": { value: "x" } }, undefined),
    "x",
  );
});

test("fromVroParameterValue round-trips what toVroParameterValue encodes", () => {
  for (const [type, value] of [
    ["string", "probe-value"],
    ["number", 42],
    ["boolean", false],
    ["Array/string", ["one", "two"]],
  ]) {
    assert.deepEqual(
      fromVroParameterValue(toVroParameterValue(type, value), type),
      value,
      `round trip failed for ${type}`,
    );
  }
});

test("formatVroValue prints the unwrapped value as JSON", () => {
  assert.equal(formatVroValue({ string: { value: "probe-2" } }, "string"), '"probe-2"');
  assert.equal(formatVroValue({ number: { value: 42 } }, "number"), "42");
  // An empty string stays visible as "" rather than rendering as blank.
  assert.equal(formatVroValue({ string: { value: "" } }, "string"), '""');
  assert.equal(
    formatVroValue({ array: { elements: [{ string: { value: "one" } }] } }, "Array/string"),
    '["one"]',
  );
  assert.equal(formatVroValue(undefined, "string"), "undefined");
});

test("formatVroValueRedacted withholds a value the server declares secure", () => {
  // The declared-type arm. This is the case VCFO-093 is about: the same type
  // that reads [redacted] as a configuration attribute printed in cleartext as
  // a workflow execution output.
  assert.equal(
    formatVroValueRedacted({ string: { value: "must-not-render" } }, "SecureString"),
    "[redacted]",
  );
  // Array/SecureString is caught by its declared type too.
  assert.equal(
    formatVroValueRedacted(
      { array: { elements: [{ string: { value: "must-not-render" } }] } },
      "Array/SecureString",
    ),
    "[redacted]",
  );
  // The envelope arm, with a permissive declared type that says nothing.
  assert.equal(
    formatVroValueRedacted({ "secure-string": { value: "must-not-render" } }, "Any"),
    "[redacted]",
  );
  // The envelope arm in isolation, with no declared type at all. No lab has
  // served a SecureString execution output, so this arm is the whole safety net
  // if vRO turns out to omit or weaken the type it reports.
  assert.equal(
    formatVroValueRedacted({ "secure-string": { value: "must-not-render" } }),
    "[redacted]",
  );
});

test("formatVroValueRedacted renders an ordinary value exactly as formatVroValue does", () => {
  // Withholding must be targeted: a plain output is still the point of reading
  // an execution at all.
  for (const [value, type] of [
    [{ string: { value: "probe-2" } }, "string"],
    [{ string: { value: "" } }, "string"],
    [{ number: { value: 42 } }, "number"],
    [{ array: { elements: [{ string: { value: "one" } }] } }, "Array/string"],
    [{ string: { value: null } }, "string"],
  ]) {
    assert.equal(
      formatVroValueRedacted(value, type),
      formatVroValue(value, type),
    );
  }
});

test("vroValueEnvelopeKeys reports the type keys of an envelope", () => {
  assert.deepEqual(vroValueEnvelopeKeys({ "secure-string": { value: "x" } }), [
    "secure-string",
  ]);
  assert.deepEqual(vroValueEnvelopeKeys("plain"), []);
  assert.deepEqual(vroValueEnvelopeKeys(undefined), []);
});

test("hasVroValue decides on the envelope, not the value inside it", () => {
  // Absent: no value key at all (the shape observed on a live execution
  // output, VCFO-123), a top-level null, and an empty envelope.
  assert.equal(hasVroValue(undefined), false);
  assert.equal(hasVroValue(null), false);
  assert.equal(hasVroValue({}), false);
  // Present, even when the value inside is falsy or null.
  assert.equal(hasVroValue({ string: { value: "" } }), true);
  assert.equal(hasVroValue({ number: { value: 0 } }), true);
  assert.equal(hasVroValue({ boolean: { value: false } }), true);
  assert.equal(hasVroValue({ string: { value: null } }), true);
});

test("formatVroValueRedacted prints (no value) for an absent value, never undefined", () => {
  assert.equal(formatVroValueRedacted(undefined, "string"), "(no value)");
  assert.equal(formatVroValueRedacted(null, "string"), "(no value)");
  assert.equal(formatVroValueRedacted({}, "string"), "(no value)");
  // A genuine falsy or null value inside an envelope renders as it always has.
  assert.equal(formatVroValueRedacted({ string: { value: "" } }, "string"), '""');
  assert.equal(formatVroValueRedacted({ number: { value: 0 } }, "number"), "0");
  assert.equal(
    formatVroValueRedacted({ boolean: { value: false } }, "boolean"),
    "false",
  );
  assert.equal(
    formatVroValueRedacted({ string: { value: null } }, "string"),
    "null",
  );
});

test("formatVroValueRedacted checks the secure type before the absent value", () => {
  assert.equal(formatVroValueRedacted(undefined, "SecureString"), "[redacted]");
  assert.equal(formatVroValueRedacted({}, "SecureString"), "[redacted]");
});

test("formatExecutionOutputValue withholds a credential-named event-broker header", () => {
  // Declared a plain string with a populated envelope: the type-based guard
  // alone would print it (VCFO-124). The value is a made-up fixture.
  assert.equal(
    formatExecutionOutputValue({
      name: "__metadata_hdr_tokenId",
      type: "string",
      value: { string: { value: "fixture-header-value" } },
    }),
    "[redacted]",
  );
  // Withheld even when absent, as a secure type is.
  assert.equal(
    formatExecutionOutputValue({ name: "__metadata_hdr_tokenId", type: "string" }),
    "[redacted]",
  );
});

test("formatExecutionOutputValue leaves other outputs on the type-based policy", () => {
  for (const name of [
    // Sibling headers the rule deliberately does not cover.
    "__metadata_hdr_encryption-context",
    "__metadata_hdr_traceparent",
    "__metadata_hdr_runnableId",
    // Event-broker metadata outside the header prefix.
    "__metadata_userName",
    "__metadata_correlationId",
    // Credential-like names without the header prefix: the rule is not general.
    "apiToken",
    "__metadata_tokenId",
  ]) {
    assert.equal(
      formatExecutionOutputValue({
        name,
        type: "string",
        value: { string: { value: "visible" } },
      }),
      '"visible"',
      name,
    );
  }
  // The type-based guard and the no-value branch still apply.
  assert.equal(
    formatExecutionOutputValue({
      name: "result",
      type: "SecureString",
      value: { string: { value: "must-not-render" } },
    }),
    "[redacted]",
  );
  assert.equal(
    formatExecutionOutputValue({ name: "__metadata_targetId", type: "string" }),
    "(no value)",
  );
});
