import { z } from "zod";

export const LIST_LIMIT_MAX = 1000;

export const listLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(LIST_LIMIT_MAX)
  .optional()
  .describe(
    `Maximum number of items to return (1–${LIST_LIMIT_MAX}). Omit for the full inventory. Applied after the filter/search; when more items exist the result says how many were shown of the total.`,
  );

/**
 * Renders a notice when list results were limited by the caller's limit
 * parameter, so agents know more items exist on the server.
 */
export function limitNote(
  list: { limited?: boolean },
  shown: number,
  total?: number,
): string {
  if (!list.limited) return "";
  const reportedTotal =
    total !== undefined && total > shown ? ` of ${total}` : "";
  if (reportedTotal) {
    return `\n\nℹ️ Showing the first ${shown}${reportedTotal} item(s) (limit ${shown}). Raise limit or narrow the query with a filter to see the rest.`;
  }
  return `\n\nℹ️ Showing the first ${shown} item(s) (limit ${shown}); the server did not report a total, so more exist. Raise limit or narrow the query with a filter to see the rest.`;
}
