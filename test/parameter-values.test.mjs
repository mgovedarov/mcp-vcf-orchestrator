import assert from "node:assert/strict";
import test from "node:test";
import {
  fromVroParameterValue,
  toVroParameterValue,
  vroValueEnvelopeKeys,
} from "../dist/client/parameters.js";
import { formatVroValue } from "../dist/tools/parameter-values.js";

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

test("vroValueEnvelopeKeys reports the type keys of an envelope", () => {
  assert.deepEqual(vroValueEnvelopeKeys({ "secure-string": { value: "x" } }), [
    "secure-string",
  ]);
  assert.deepEqual(vroValueEnvelopeKeys("plain"), []);
  assert.deepEqual(vroValueEnvelopeKeys(undefined), []);
});
