import { z } from "zod";

export const LIST_LIMIT_MAX = 1000;

export const listLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(LIST_LIMIT_MAX)
  .optional()
  .describe(
    `Maximum number of items to return (1–${LIST_LIMIT_MAX}). Omit for the full inventory. Applied after any supported filter/search; additional matches are reported, with a total when known.`,
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
  const ofTotal = total !== undefined && total > shown ? ` of ${total}` : "";
  return `\n\n⚠️ Results limited: showing the first ${shown}${ofTotal} item(s). More matching results exist. Raise the limit or refine filters/search where supported.`;
}
