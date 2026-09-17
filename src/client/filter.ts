/**
 * Client-side name filtering shared by the list clients whose endpoint either
 * ignores the server-side `conditions` query (the vRO embedded in vRA 8 does
 * for `/plugins`), has no server-side filter at all (actions, configurations,
 * workflows by category), or rejects the one it is sent (projects fall back
 * here when the service answers the OData `$filter` with 400). One
 * normalization for all of them, so `" Library"` matches the same set
 * everywhere — and, for projects, the lower-cased needle is what the
 * server-side `tolower()` filter is built from.
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

/**
 * Case-insensitive substring match against an item's name **or** description,
 * the predicate the Automation list clients share.
 *
 * Two fields rather than one, because the project-service's own server-side
 * `$filter` already spans both (see projectSearchFilter) and the tools these
 * back advertised `search` as matching a name *or keyword* before any of it
 * was matched locally — a name-only predicate would have narrowed a documented
 * contract. Keeping one predicate means `list-projects`' client-side fallback
 * and the three `$search` listings select the same rows for the same needle.
 */
export function matchesNameOrDescription(
  item: { name?: string | undefined; description?: string | undefined },
  needle: string,
): boolean {
  return (
    matchesFilter(item.name, needle) || matchesFilter(item.description, needle)
  );
}
