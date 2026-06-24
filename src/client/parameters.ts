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
