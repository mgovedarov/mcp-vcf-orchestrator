import type { VroHttpClient } from "./core.js";
import { matchesFilter, normalizeFilter } from "./filter.js";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_REQUESTS = 1_000;

interface VroPage<T> {
  link?: T[];
  start?: number;
  total?: number;
  /** Endpoint-specific item arrays selected via `itemKeys` (e.g. `plugins`). */
  [key: string]: unknown;
}

interface AutomationPage<T> {
  content?: T[];
  first?: boolean;
  last?: boolean;
  number?: number;
  numberOfElements?: number;
  size?: number;
  totalElements?: number;
  totalPages?: number;
}

export interface VroPageResult<T> {
  link: T[];
  start?: number;
  total?: number;
  /** Present (true) when collection stopped at the page-request cap. */
  truncated?: boolean;
  /** Present (true) when the caller's maxItems dropped items that exist on the server. */
  limited?: boolean;
}

export interface AutomationPageResult<T> {
  content: T[];
  numberOfElements?: number;
  totalElements?: number;
  /** Present (true) when collection stopped at the page-request cap. */
  truncated?: boolean;
  /** Present (true) when the caller's maxItems dropped items that exist on the server. */
  limited?: boolean;
}

function isQueryCountUnsupported(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("isQueryCount is not implemented")
  );
}

function encodeQueryComponent(value: string): string {
  // RFC 3986-strict variant of encodeURIComponent (also encodes ! ' ( ) *).
  // ~ is unreserved and stays literal; $ is encoded as %24. Unlike
  // URLSearchParams.toString(), * serializes as %2A (wire-equivalent after
  // server-side decoding).
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function formatQuery(params: URLSearchParams): string {
  const parts: string[] = [];
  for (const [key, value] of params) {
    // OData system query keys ($filter, $search, $top, ...) must keep a
    // literal $ in the key; some VMware Automation endpoints reject %24filter.
    const encodedKey = /^\$[A-Za-z]+$/.test(key)
      ? key
      : encodeQueryComponent(key);
    parts.push(`${encodedKey}=${encodeQueryComponent(value)}`);
  }
  return parts.join("&");
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = formatQuery(params);
  return query ? `${path}?${query}` : path;
}

// Cheap ~53-bit signature of a serialized page, formed from two independent
// 32-bit FNV-1a streams (distinct offset bases) combined as "h1:h2". We store
// the signature rather than the full page so repeat-detection memory stays
// ~constant per page even for large listings. At the <=1000-page cap the
// birthday collision probability is ~1e-13; a false positive would only surface
// as a pagination-did-not-advance error.
function hashPageItems(items: unknown): string {
  const json = JSON.stringify(items);
  let h1 = 0x811c9dc5;
  let h2 = 0xc59d1c81;
  for (let i = 0; i < json.length; i += 1) {
    const code = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x01000193);
  }
  return `${h1 >>> 0}:${h2 >>> 0}`;
}

const DEFAULT_ITEM_KEYS: readonly string[] = ["link"];

/**
 * Most vRO list endpoints return page items under `link`. A few answer a flat
 * envelope instead — the vRO embedded in vRA 8 serves `GET /vco/api/plugins`
 * as `{ plugins: [...], total }` — so callers may name alternative keys. They
 * are tried in order and the first array found is the page.
 */
function pageItems<T>(page: VroPage<T>, itemKeys: readonly string[]): T[] {
  for (const key of itemKeys) {
    const value = page[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

/**
 * A reported total is only usable when the server actually knows it; some
 * endpoints (e.g. vRA 8's `/workflows`) send `-1` as an "unknown count"
 * sentinel, which must be treated the same as no total at all.
 */
function knownTotal(reportedTotal: number | undefined): number | undefined {
  return reportedTotal !== undefined && reportedTotal >= 0
    ? reportedTotal
    : undefined;
}

/**
 * Applies an item limit to a client-side-filtered list, slicing to the limit
 * and reporting whether items were dropped.
 */
export function applyListLimit<T>(
  items: T[],
  limit?: number,
): { items: T[]; limited: boolean; total: number } {
  const total = items.length;
  if (limit === undefined) return { items, limited: false, total };
  if (items.length <= limit) return { items, limited: false, total };
  return { items: items.slice(0, limit), limited: true, total };
}

export async function getAllVroPages<T>(
  http: VroHttpClient,
  path: string,
  params: URLSearchParams = new URLSearchParams(),
  options: {
    pageSize?: number;
    queryCount?: boolean;
    maxPageRequests?: number;
    maxItems?: number;
    itemFilter?: (item: T) => boolean;
    /** Response keys that may hold the page items, tried in order. Defaults to `["link"]`. */
    itemKeys?: readonly string[];
  } = {},
): Promise<VroPageResult<T>> {
  const maxItems = options.maxItems;
  const pageSize =
    maxItems === undefined || options.itemFilter
      ? options.pageSize ?? DEFAULT_PAGE_SIZE
      : Math.min(options.pageSize ?? DEFAULT_PAGE_SIZE, maxItems);
  const maxPageRequests = options.maxPageRequests ?? MAX_PAGE_REQUESTS;
  const itemKeys = options.itemKeys ?? DEFAULT_ITEM_KEYS;
  let queryCount = options.queryCount ?? true;
  const link: T[] = [];
  let start = 0;
  let firstStart: number | undefined;
  let reportedTotal: number | undefined;
  let rawCount = 0;
  let complete = false;
  const seenPageSignatures = new Set<string>();

  let requestCount = 0;
  for (; requestCount < maxPageRequests; requestCount += 1) {
    const buildPagePath = (includeQueryCount: boolean): string => {
      const pageParams = new URLSearchParams(params);
      pageParams.set("maxResult", String(pageSize));
      pageParams.set("startIndex", String(start));
      if (includeQueryCount) pageParams.set("queryCount", "true");
      return withQuery(path, pageParams);
    };

    let page: VroPage<T>;
    try {
      page = await http.get<VroPage<T>>(buildPagePath(queryCount));
    } catch (error) {
      if (!queryCount || !isQueryCountUnsupported(error)) throw error;
      queryCount = false;
      reportedTotal = undefined;
      page = await http.get<VroPage<T>>(buildPagePath(false));
    }
    const items = pageItems(page, itemKeys);
    if (firstStart === undefined) firstStart = page.start;
    if (queryCount && page.total !== undefined && page.total >= 0)
      reportedTotal = page.total;

    if (items.length > 0) {
      const signature = hashPageItems(items);
      if (seenPageSignatures.has(signature)) {
        throw new Error(
          `vRO pagination did not advance for ${path}; received a repeated page at startIndex=${start}`,
        );
      }
      seenPageSignatures.add(signature);
    }

    rawCount += items.length;
    link.push(...(options.itemFilter ? items.filter(options.itemFilter) : items));
    complete = items.length === 0 ||
      (reportedTotal !== undefined && rawCount >= reportedTotal) ||
      (items.length < pageSize && reportedTotal === undefined);
    if (complete) break;

    if (maxItems !== undefined) {
      const haveKnownTotal = !options.itemFilter && knownTotal(reportedTotal) !== undefined;
      if (haveKnownTotal ? link.length >= maxItems : link.length > maxItems) {
        break;
      }
    }

    start += items.length;
  }

  const truncated = requestCount >= maxPageRequests;
  // A server total counts what the server returned, so it is a matching total
  // only when the local filter dropped nothing — every raw row passed it, which
  // is what a server that honored `conditions` sends back. Otherwise it counts
  // the unfiltered inventory and must not be reported as a match count. A
  // completed walk reaches the same number through the `link.length` fallback
  // below; this keeps the count when a honored filter has more matches than the
  // item limit, which stops the walk early. An ignored filter that every
  // fetched row happens to satisfy can still overstate the tail, so treat this
  // as an upper bound rather than a proof the server filtered.
  const matchingTotal =
    options.itemFilter && rawCount !== link.length ? undefined : reportedTotal;
  const total = matchingTotal ?? (maxItems === undefined || complete ? link.length : undefined);
  let limited = false;
  if (maxItems !== undefined) {
    limited = link.length > maxItems ||
      (link.length >= maxItems && matchingTotal !== undefined && matchingTotal > maxItems);
    if (link.length > maxItems) link.length = maxItems;
  }

  return {
    link,
    ...(firstStart !== undefined ? { start: firstStart } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(truncated ? { truncated } : {}),
    ...(limited ? { limited } : {}),
  };
}

/**
 * Collects a paginated vRO list and applies the name filter client-side.
 *
 * Several vRO list endpoints accept `conditions=name~<filter>` and ignore it:
 * the vRO embedded in vRA 8.18.1 answers `/packages`, `/categories`,
 * `/configurations` and `/resources` with the full inventory whatever the
 * filter says (verified in the lab, VCFO-073), while `/workflows` honors it.
 * `conditions` is still sent — it reduces the payload where it is honored, and
 * post-filtering a list the server already filtered is a no-op — but the
 * result is matched locally so the filter is never silently dropped.
 *
 * `itemFilter` is passed only when a limit is set: without one there is
 * nothing to window and the single post-map pass below suffices, but with one
 * the filter has to run inside pagination or `maxItems` would count
 * non-matching rows. Mapping a raw row twice on that path is cheap and avoids
 * a second per-call-site name extractor, since `map` already encodes each
 * type's name fallbacks.
 *
 * Unlike `WorkflowClient.listWorkflows`, which only *detects* a filter
 * violation and then re-lists via the category tree, these listings have no
 * fallback to reach for and simply filter.
 *
 * `total` is reported three ways, deliberately differing from
 * `ActionClient.listActions` (which always reports the match count when no
 * limit is set). Keep the no-filter branch as a pass-through: unfiltered
 * listings must reproduce the server's own total exactly, unchanged by this
 * fix.
 */
export async function getFilteredVroList<
  TRaw,
  TItem extends { name?: string | undefined },
>(
  http: VroHttpClient,
  path: string,
  params: URLSearchParams,
  map: (raw: TRaw) => TItem,
  filter: string | undefined,
  limit: number | undefined,
): Promise<VroPageResult<TItem>> {
  const needle = normalizeFilter(filter);
  const raw = await getAllVroPages<TRaw>(http, path, params, {
    maxItems: limit,
    itemFilter:
      limit !== undefined && needle
        ? (item) => matchesFilter(map(item).name, needle)
        : undefined,
  });
  let link: TItem[] = (raw.link ?? []).map(map);
  if (needle) {
    link = link.filter((item) => matchesFilter(item.name, needle));
  }
  // No filter: the server total describes exactly what was requested. Filter
  // without a limit: the server total describes the unfiltered inventory, so
  // report the match count instead. Filter with a limit: getAllVroPages
  // already reported the match count, kept the server total where the filter
  // was honored server-side, or omitted it when the walk stopped before
  // proving one.
  const total =
    needle === undefined ? raw.total : limit === undefined ? link.length : raw.total;
  return {
    link,
    ...(raw.start !== undefined ? { start: raw.start } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(raw.truncated ? { truncated: true } : {}),
    ...(raw.limited ? { limited: true } : {}),
  };
}

export async function getAllAutomationPages<T>(
  http: VroHttpClient,
  path: string,
  baseUrl: string,
  params: URLSearchParams = new URLSearchParams(),
  options: {
    pageSize?: number;
    maxPageRequests?: number;
    maxItems?: number;
    itemFilter?: (item: T) => boolean;
  } = {},
): Promise<AutomationPageResult<T>> {
  const maxItems = options.maxItems;
  const pageSize =
    maxItems === undefined || options.itemFilter
      ? options.pageSize ?? DEFAULT_PAGE_SIZE
      : Math.min(options.pageSize ?? DEFAULT_PAGE_SIZE, maxItems);
  const maxPageRequests = options.maxPageRequests ?? MAX_PAGE_REQUESTS;
  const content: T[] = [];
  let reportedTotal: number | undefined;
  let totalPages: number | undefined;
  let rawCount = 0;
  let complete = false;
  const seenPageSignatures = new Set<string>();

  let pageNumber = 0;
  for (; pageNumber < maxPageRequests; pageNumber += 1) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("page", String(pageNumber));
    pageParams.set("size", String(pageSize));

    const page = await http.get<AutomationPage<T>>(
      withQuery(path, pageParams),
      baseUrl,
    );
    const items = page.content ?? [];
    if (page.totalElements !== undefined && page.totalElements >= 0)
      reportedTotal = page.totalElements;
    if (page.totalPages !== undefined) totalPages = page.totalPages;

    if (items.length > 0) {
      const signature = hashPageItems(items);
      if (seenPageSignatures.has(signature)) {
        throw new Error(
          `Automation pagination did not advance for ${path}; received a repeated page at page=${pageNumber}`,
        );
      }
      seenPageSignatures.add(signature);
    }

    rawCount += items.length;
    content.push(...(options.itemFilter ? items.filter(options.itemFilter) : items));
    complete = items.length === 0 || page.last === true ||
      (totalPages !== undefined && pageNumber + 1 >= totalPages) ||
      (reportedTotal !== undefined && rawCount >= reportedTotal) ||
      (items.length < pageSize && reportedTotal === undefined && totalPages === undefined);
    if (complete) break;

    if (maxItems !== undefined) {
      const haveKnownTotal = !options.itemFilter && knownTotal(reportedTotal) !== undefined;
      if (
        haveKnownTotal
          ? content.length >= maxItems
          : content.length > maxItems
      ) {
        break;
      }
    }
  }

  const truncated = pageNumber >= maxPageRequests;
  const matchingTotal = options.itemFilter ? undefined : reportedTotal;
  const totalElements = matchingTotal ?? (maxItems === undefined || complete ? content.length : undefined);
  let limited = false;
  if (maxItems !== undefined) {
    limited = content.length > maxItems ||
      (content.length >= maxItems && matchingTotal !== undefined && matchingTotal > maxItems);
    if (content.length > maxItems) content.length = maxItems;
  }

  return {
    content,
    numberOfElements: content.length,
    ...(totalElements !== undefined ? { totalElements } : {}),
    ...(truncated ? { truncated } : {}),
    ...(limited ? { limited } : {}),
  };
}
