const SDK_OBJECT_KEY = "sdk-object";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * The vRO REST API keys parameter values by the canonical lowercase/hyphenated
 * type literal ("secure-string", "mime-attachment"), not the display type used
 * in workflow definitions ("SecureString"). POST /workflows/{id}/executions
 * rejects display-type keys with a 400 HTML error page, so the workflow's
 * declared type cannot be used verbatim as the JSON key.
 */
function vroValueKey(type: string): string {
  const lower = type.toLowerCase();
  // Array and composite checks must precede the SDK-object check: both
  // "Array/VC:VirtualMachine" and "CompositeType(field:string):Name"
  // contain ":" without being plain SDK object types.
  if (lower.startsWith("array/")) return "array";
  if (lower.startsWith("composite")) return "composite";
  if (type.includes(":")) return SDK_OBJECT_KEY;
  return type.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export function toVroParameterValue(
  type: string,
  value: unknown,
): Record<string, unknown> {
  const key = vroValueKey(type);

  if (key === SDK_OBJECT_KEY) {
    return {
      [SDK_OBJECT_KEY]: isRecord(value) ? value : { id: value, type },
    };
  }

  if (key === "array") {
    const componentType = type.slice(type.indexOf("/") + 1);
    const elements = (Array.isArray(value) ? value : [value]).map((element) =>
      toVroParameterValue(componentType, element),
    );
    return { array: { elements } };
  }

  if (key === "properties") {
    if (!isRecord(value)) {
      throw new Error(
        `Properties parameter (type "${type}") expects an object of key/value pairs, received ${describeValueType(value)}.`,
      );
    }
    if ("property" in value) {
      return { properties: value };
    }
    return {
      properties: {
        property: Object.entries(value).map(([name, entry]) => ({
          key: name,
          value: toVroParameterValue(
            typeof entry === "number" || typeof entry === "boolean"
              ? typeof entry
              : "string",
            entry,
          ),
        })),
      },
    };
  }

  if (key === "composite") {
    if (!isRecord(value)) {
      throw new Error(
        `Composite parameter (type "${type}") expects an object, received ${describeValueType(value)}.`,
      );
    }
    return { composite: value };
  }

  return { [key]: { value } };
}

/**
 * Inverse of {@link toVroParameterValue}: unwrap a vRO value envelope back to
 * the plain value it carries, so a read surface can print `"probe-2"` instead
 * of `{"string":{"value":"probe-2"}}`.
 *
 * Matching is structural, with the declared type only as a hint, because the
 * envelope key is the authority and the type is not always spelled the way the
 * key is — vRO answers a `Date` attribute with the lowercase `date` key, and an
 * `Array/string` with `array`. The hint is tried first via the same
 * {@link vroValueKey} mapping the encoder uses, then any single-key envelope is
 * accepted, so a type this code has never seen still unwraps.
 *
 * Shapes verified on vRO 8.18.1 (VCFO-080):
 *
 * - `{"string":{"value":"probe-2"}}`, `{"number":{"value":42}}`,
 *   `{"boolean":{"value":true}}`, `{"date":{"value":"…"}}` → the scalar,
 *   including a falsy one such as `""`.
 * - `{"array":{"elements":[…]}}` → an array of unwrapped elements.
 * - `{"sdk-object":{"type":…,"href":…,"id":…}}` → the descriptor object.
 * - `{"properties":{"property":[{"key":…,"value":{…}}]}}` → a plain object.
 *   Taken from the encoder rather than the lab: a `Properties` attribute cannot
 *   currently be authored through the configuration tools, so no live sample
 *   could be produced.
 *
 * Anything unrecognized — a multi-key envelope, an inner object without a
 * `value` — is returned untouched so the caller renders the raw shape rather
 * than a lossy guess.
 */
export function fromVroParameterValue(value: unknown, type?: string): unknown {
  if (!isRecord(value)) return value;

  const inner = pickEnvelopeBody(value, type);
  if (inner === undefined) return value;
  const { key, body } = inner;

  if (key === "array") {
    if (!isRecord(body) || !Array.isArray(body.elements)) return value;
    const componentType =
      type && type.toLowerCase().startsWith("array/")
        ? type.slice(type.indexOf("/") + 1)
        : undefined;
    return body.elements.map((element) =>
      fromVroParameterValue(element, componentType),
    );
  }

  if (key === "properties") {
    if (!isRecord(body) || !Array.isArray(body.property)) return value;
    const entries: Record<string, unknown> = {};
    for (const property of body.property) {
      if (!isRecord(property) || typeof property.key !== "string") continue;
      entries[property.key] = fromVroParameterValue(property.value);
    }
    return entries;
  }

  // An SDK object or a composite carries its own fields rather than a scalar;
  // the descriptor is the value.
  if (key === SDK_OBJECT_KEY || key === "composite") return body;

  if (isRecord(body) && "value" in body) return body.value;

  return value;
}

/**
 * Select the body of a single-type value envelope, preferring the key the
 * declared type maps to and otherwise accepting a lone key. Returns undefined
 * for anything that is not an envelope (empty, or several type keys at once).
 */
function pickEnvelopeBody(
  value: Record<string, unknown>,
  type?: string,
): { key: string; body: unknown } | undefined {
  if (type) {
    const key = vroValueKey(type);
    if (key in value) return { key, body: value[key] };
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) return undefined;
  const key = keys[0] as string;
  return { key, body: value[key] };
}

/** The type keys present in a value envelope, for secure-value detection. */
export function vroValueEnvelopeKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

export function toVroParameters(
  params: { name: string; type: string; value?: unknown }[],
): { name: string; type: string; value?: Record<string, unknown> }[] {
  return params.map((p) => ({
    name: p.name,
    type: p.type,
    value:
      p.value !== undefined ? toVroParameterValue(p.type, p.value) : undefined,
  }));
}
