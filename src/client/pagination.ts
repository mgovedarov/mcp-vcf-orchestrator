import type { VroHttpClient } from "./core.js";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_REQUESTS = 1_000;

interface VroPage<T> {
  link?: T[];
  start?: number;
  total?: number;
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
}

export interface AutomationPageResult<T> {
  content: T[];
  numberOfElements?: number;
  totalElements?: number;
  /** Present (true) when collection stopped at the page-request cap. */
  truncated?: boolean;
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

export async function getAllVroPages<T>(
  http: VroHttpClient,
  path: string,
  params: URLSearchParams = new URLSearchParams(),
  options: {
    pageSize?: number;
    queryCount?: boolean;
    maxPageRequests?: number;
  } = {},
): Promise<VroPageResult<T>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPageRequests = options.maxPageRequests ?? MAX_PAGE_REQUESTS;
  let queryCount = options.queryCount ?? true;
  const link: T[] = [];
  let start = 0;
  let firstStart: number | undefined;
  let reportedTotal: number | undefined;
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
    const items = page.link ?? [];
    if (firstStart === undefined) firstStart = page.start;
    if (queryCount && page.total !== undefined) reportedTotal = page.total;

    if (items.length > 0) {
      const signature = hashPageItems(items);
      if (seenPageSignatures.has(signature)) {
        throw new Error(
          `vRO pagination did not advance for ${path}; received a repeated page at startIndex=${start}`,
        );
      }
      seenPageSignatures.add(signature);
    }

    link.push(...items);

    if (items.length === 0) break;
    if (reportedTotal !== undefined && link.length >= reportedTotal) break;
    if (items.length < pageSize && reportedTotal === undefined) break;

    start += items.length;
  }

  const truncated = requestCount >= maxPageRequests;
  return {
    link,
    ...(firstStart !== undefined ? { start: firstStart } : {}),
    total: reportedTotal ?? link.length,
    ...(truncated ? { truncated } : {}),
  };
}

export async function getAllAutomationPages<T>(
  http: VroHttpClient,
  path: string,
  baseUrl: string,
  params: URLSearchParams = new URLSearchParams(),
  options: { pageSize?: number; maxPageRequests?: number } = {},
): Promise<AutomationPageResult<T>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPageRequests = options.maxPageRequests ?? MAX_PAGE_REQUESTS;
  const content: T[] = [];
  let reportedTotal: number | undefined;
  let totalPages: number | undefined;
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
    if (page.totalElements !== undefined) reportedTotal = page.totalElements;
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

    content.push(...items);

    if (items.length === 0) break;
    if (page.last === true) break;
    if (totalPages !== undefined && pageNumber + 1 >= totalPages) break;
    if (reportedTotal !== undefined && content.length >= reportedTotal) break;
    if (
      items.length < pageSize &&
      reportedTotal === undefined &&
      totalPages === undefined
    ) {
      break;
    }
  }

  const truncated = pageNumber >= maxPageRequests;
  return {
    content,
    numberOfElements: content.length,
    totalElements: reportedTotal ?? content.length,
    ...(truncated ? { truncated } : {}),
  };
}
