import { fromVroParameterValue } from "../client/parameters.js";

/**
 * Render a vRO value envelope for a human or an agent reading a tool result.
 *
 * The value is unwrapped from its type envelope first (see
 * {@link fromVroParameterValue}) and then printed as JSON, so a string comes
 * back quoted and an empty string reads as `""` rather than as blank space.
 * Shared by the configuration and workflow-execution read surfaces so the two
 * cannot drift apart.
 */
export function formatVroValue(value: unknown, type?: string): string {
  const unwrapped = fromVroParameterValue(value, type);
  const json = JSON.stringify(unwrapped);
  return json === undefined ? String(unwrapped) : json;
}
