/**
 * Renders a warning for list results whose server-side pagination stopped at
 * the page-request cap, so callers never mistake a partial list for the
 * complete inventory. Returns an empty string for complete results.
 *
 * Call it on the empty-result branch too, unconditionally. A list that filters
 * client-side can collect zero matches from a walk that still stopped at the
 * cap, and gating the note on a caller-supplied limit rendered that as a bare
 * "No … found." — a partial inventory reported as an empty one, which is the
 * silent false negative VCFO-098 hardened against (VCFO-100).
 */
export function truncationNote(
  list: { truncated?: boolean },
  collected: number,
  total?: number,
): string {
  if (!list.truncated) return "";
  const ofTotal =
    total !== undefined && total > collected ? ` of ~${total}` : "";
  return `\n\n⚠️ Results truncated: the pagination request limit was reached after collecting ${collected}${ofTotal} item(s). Narrow the query with a filter to retrieve the rest.`;
}
