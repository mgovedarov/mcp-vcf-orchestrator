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
  const ofTotal = total !== undefined && total > shown ? ` of ~${total}` : "";
  return `\n\n⚠️ Results limited: showing the first ${shown}${ofTotal} item(s) (limit ${shown}). Raise the limit or narrow the query with a filter to see the rest.`;
}
