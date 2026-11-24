import { fromVroParameterValue } from "../client/parameters.js";
import {
  REDACTED,
  isSecureAttributeValue,
  isSensitiveEventHeaderName,
} from "../redaction.js";

/** The marker printed for a parameter vRO returned with no value at all. */
export const NO_VALUE = "(no value)";

/**
 * True when vRO returned a value for a parameter or attribute.
 *
 * The check is on the envelope, not on the value inside it. A parameter with
 * no `value` key, a top-level `null`, or an empty envelope `{}` carries
 * nothing; an envelope holding `""`, `0`, `false` or `null` carries that value
 * and must render it rather than read as unset.
 *
 * Both absent shapes are observed. The built-in `BatchAction` configuration
 * element declares `Array/Action` attributes with no value (VCFO-080), and an
 * execution output of an event-triggered workflow arrives with no `value` key
 * at all, e.g. `{"name":"__metadata_targetId","type":"string","scope":"token"}`
 * (VCFO-123).
 */
export function hasVroValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

/**
 * Render a vRO value envelope for a human or an agent reading a tool result.
 *
 * The value is unwrapped from its type envelope first (see
 * {@link fromVroParameterValue}) and then printed as JSON, so a string comes
 * back quoted and an empty string reads as `""` rather than as blank space.
 *
 * This withholds nothing and does not check for an absent value. Call
 * {@link formatVroValueRedacted} instead; this function is the formatting half
 * that the sibling delegates to.
 */
export function formatVroValue(value: unknown, type?: string): string {
  const unwrapped = fromVroParameterValue(value, type);
  const json = JSON.stringify(unwrapped);
  return json === undefined ? String(unwrapped) : json;
}

/**
 * Render a vRO value, withholding it when the server declares it secure and
 * printing {@link NO_VALUE} when vRO returned none.
 *
 * This is the pairing that keeps the configuration and workflow-execution read
 * surfaces from drifting apart. Both print `name (type): value` from the same
 * `{name, type, value}` shape, and for a long time only the configuration one
 * checked the type before printing -- so a `SecureString` was `[redacted]` as a
 * configuration attribute and cleartext as an execution output (VCFO-093).
 * Sharing the renderer had kept the *formatting* aligned while the guard lived
 * at one call site of three. The no-value branch drifted the same way: only
 * `get-configuration` had one, so an absent execution output printed the bare
 * word `undefined` (VCFO-123).
 *
 * The secure check runs first, so a secure-typed parameter reads `[redacted]`
 * whether or not it carries a value.
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
  if (isSecureAttributeValue(type, value)) return REDACTED;
  if (!hasVroValue(value)) return NO_VALUE;
  return formatVroValue(value, type);
}

/**
 * Render one workflow execution output parameter's value.
 *
 * This is {@link formatVroValueRedacted} plus one narrow name rule, for
 * execution outputs only: an event-broker header output whose name reads as
 * credential material is withheld whatever its declared type says (see
 * {@link isSensitiveEventHeaderName}). vRO declares such a header as a plain
 * `string`, so the type-based guard alone prints it (VCFO-124). Every other
 * output stays on the type-based policy.
 */
export function formatExecutionOutputValue(parameter: {
  name: string;
  type?: string;
  value?: unknown;
}): string {
  if (isSensitiveEventHeaderName(parameter.name)) return REDACTED;
  return formatVroValueRedacted(parameter.value, parameter.type);
}
