import { createHash } from "node:crypto";

/**
 * Summarizes bulky artifact content that a get-* tool omitted by default,
 * mirroring the context snapshot's contentMetadata reduction (sha256 +
 * length) and telling the caller which flag re-enables the full output.
 */
export function omittedContentSummary(
  label: string,
  content: string,
  toolName: string,
  flagName: string,
): string {
  const sha256 = createHash("sha256").update(content).digest("hex");
  return `${label}: omitted (sha256: ${sha256}, length: ${content.length} chars). Re-call ${toolName} with ${flagName}: true for the full ${label.toLowerCase()}.`;
}
