import { createHash } from "node:crypto";

/**
 * The stand-in a JSON surface serves in place of bulky content it withheld.
 *
 * `included: false` is stated rather than implied so a consumer can tell a
 * withheld field from a missing one, and the digest plus length let it detect a
 * change, compare two surfaces, or decide whether fetching the real thing is
 * worth it.
 */
export interface ContentMetadata {
  included: false;
  sha256: string;
  length: number;
}

/**
 * Reduce bulky content to a digest and a length for a JSON body.
 *
 * This is the JSON counterpart of `omittedContentSummary` in
 * src/tools/content-summary.ts: same reduction, different medium. That one
 * returns an English sentence naming the tool and flag that re-enable the
 * content, which is right in a tool's text result and wrong inside a JSON
 * field; this returns the structured shape the context snapshot has always
 * written.
 *
 * The digest is a plain hex sha256 of the content exactly as given -- no
 * salting, no truncation, no normalization -- and `omittedContentSummary`
 * builds its digest the same way, so the two surfaces agree byte for byte on
 * the same input. Callers must therefore hash what the tool hashes: a raw
 * script string, or a `JSON.stringify(value, null, 2)` rendering where that is
 * what the tool summarized.
 *
 * Returns `undefined` for absent content, so a field that was never served
 * stays absent rather than gaining a summary of nothing.
 */
export function contentMetadata(content?: string): ContentMetadata | undefined {
  if (content === undefined) return undefined;
  return {
    included: false,
    sha256: createHash("sha256").update(content).digest("hex"),
    length: content.length,
  };
}
