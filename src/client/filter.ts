/**
 * Client-side name filtering shared by the list clients whose endpoint either
 * ignores the server-side `conditions` query (the vRO embedded in vRA 8 does
 * for `/plugins`) or has no server-side filter at all (projects, actions,
 * configurations, workflows by category). One normalization for all of them,
 * so `" Library"` matches the same set everywhere.
 */

/**
 * Normalize a user-supplied filter: trimmed and lower-cased. Returns undefined
 * for a missing or blank filter so callers can skip filtering with one check.
 */
export function normalizeFilter(filter: string | undefined): string | undefined {
  const needle = filter?.trim().toLowerCase();
  return needle ? needle : undefined;
}

/**
 * Case-insensitive substring match of `value` against a needle produced by
 * normalizeFilter. A missing value never matches.
 */
export function matchesFilter(
  value: string | undefined,
  needle: string,
): boolean {
  return value !== undefined && value.toLowerCase().includes(needle);
}
