import { fromVroParameterValue } from "../client/parameters.js";
import { REDACTED, isSecureAttributeValue } from "../redaction.js";

/**
 * Render a vRO value envelope for a human or an agent reading a tool result.
 *
 * The value is unwrapped from its type envelope first (see
 * {@link fromVroParameterValue}) and then printed as JSON, so a string comes
 * back quoted and an empty string reads as `""` rather than as blank space.
 *
 * This withholds nothing. Call {@link formatVroValueRedacted} instead, unless
 * a secure-value guard has already run at the call site -- `get-configuration`
 * in src/tools/config-tools.ts is the one such caller, because it has a third
 * branch for an attribute vRO returned no value for at all. This function is
 * the formatting half that the sibling delegates to.
 */
export function formatVroValue(value: unknown, type?: string): string {
  const unwrapped = fromVroParameterValue(value, type);
  const json = JSON.stringify(unwrapped);
  return json === undefined ? String(unwrapped) : json;
}

/**
 * Render a vRO value, withholding it when the server declares it secure.
 *
 * This is the pairing that keeps the configuration and workflow-execution read
 * surfaces from drifting apart. Both print `name (type): value` from the same
 * `{name, type, value}` shape, and for a long time only the configuration one
 * checked the type before printing -- so a `SecureString` was `[redacted]` as a
 * configuration attribute and cleartext as an execution output (VCFO-093).
 * Sharing the renderer had kept the *formatting* aligned while the guard lived
 * at one call site of three.
 *
 * The detection is {@link isSecureAttributeValue}, unchanged and unduplicated:
 * a declared type reading secure or encrypted, or a value that arrived wrapped
 * in such an envelope whatever its declared type says. Both arms matter here.
 * A configuration attribute's guard is defensive, since vRO does not return a
 * `SecureString` attribute value at all; an execution output is a value the
 * engine just produced and does return, and the shape it arrives in has not
 * been observed on any lab, so keying off the envelope as well as the type is
 * what makes this hold whichever shape the platform serves.
 *
 * Note the limit, which every caller must state in its own tool description and
 * docs: the signal has to be a declared type or an envelope key. An
 * `Array/SecureString` is caught by its type, but a secret sitting inside a
 * `Properties` or a composite type is announced by neither and is printed. This
 * is a stronger signal than the key-name heuristic in src/redaction.ts, not a
 * complete one.
 */
export function formatVroValueRedacted(value: unknown, type?: string): string {
  return isSecureAttributeValue(type, value)
    ? REDACTED
    : formatVroValue(value, type);
}
