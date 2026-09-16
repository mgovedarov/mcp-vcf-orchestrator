/**
 * Withhold values that read as credential material from a free-form key/value
 * map.
 *
 * Some things this server renders are untyped: project custom properties and a
 * deployment's requested `inputs` are both plain string-keyed maps carrying
 * whatever the platform was given, with no per-key marker saying which value is
 * a secret. Configuration attributes carry a declared type and catalog item
 * schema properties carry an `encrypted` flag, so those surfaces redact on a
 * signal the service itself supplies; these two have no such signal, and the
 * project's never-print-secrets rule still applies to them.
 *
 * So the key's own name is the signal. This is a heuristic and not a guarantee
 * -- a secret under a key this pattern does not match is printed -- which every
 * caller of this module must say plainly in its tool description and docs.
 */
const SENSITIVE_PROPERTY_KEY =
  /(password|passwd|secret|token|credential|private[-_]?key|api[-_]?key)/i;

/** The marker printed in place of a withheld value, shared by every surface. */
export const REDACTED = "[redacted]";

/** True when a key's name suggests the value under it is credential material. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PROPERTY_KEY.test(key);
}

/**
 * Copy `value`, replacing every sensitive-keyed value with {@link REDACTED},
 * recursing through plain objects and arrays.
 *
 * The recursion is the point. A deployment input can itself be an object -- a
 * blueprint input of type `object` is ordinary -- so a top-level-only check
 * would print `{"user":"root","privateKey":"..."}` verbatim and redact nothing,
 * even though `privateKey` is exactly what the pattern is for. Nesting must not
 * be a way around the guard.
 *
 * Only plain objects and arrays are traversed; anything else (a string, a
 * number, a `Date`, `null`) is returned as-is, so this cannot mangle a value
 * shape it does not understand.
 */
export function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValues(entry));
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redactSensitiveValues(entry);
    }
    return result;
  }
  return value;
}

/**
 * True when `value` is, or contains anywhere beneath it, a sensitive key.
 *
 * {@link redactSensitiveValues} cannot answer this by identity: it copies every
 * object and array it walks, so a caller comparing its result against the input
 * would see a change for any structured value whether or not anything was
 * actually withheld.
 */
export function containsSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsSensitiveKey(entry));
  }
  if (isPlainObject(value)) {
    return Object.entries(value).some(
      ([key, entry]) => isSensitiveKey(key) || containsSensitiveKey(entry),
    );
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
