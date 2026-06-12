/**
 * Renders a warning for list results whose server-side pagination stopped at
 * the page-request cap, so callers never mistake a partial list for the
 * complete inventory. Returns an empty string for complete results.
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
