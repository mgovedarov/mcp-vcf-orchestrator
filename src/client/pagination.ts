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
}

export interface AutomationPageResult<T> {
  content: T[];
  numberOfElements?: number;
  totalElements?: number;
}

export function formatQuery(params: URLSearchParams): string {
  return params
    .toString()
    .replace(/\+/g, "%20")
    .replace(/%24/g, "$")
    .replace(/%7E/gi, "~");
}

export async function getAllVroPages<T>(
  http: VroHttpClient,
  path: string,
  params: URLSearchParams = new URLSearchParams(),
  options: { pageSize?: number } = {},
): Promise<VroPageResult<T>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const link: T[] = [];
  let start = 0;
  let firstStart: number | undefined;
  let reportedTotal: number | undefined;
  let previousResponseStart: number | undefined;

  for (let requestCount = 0; requestCount < MAX_PAGE_REQUESTS; requestCount += 1) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("maxResult", String(pageSize));
    pageParams.set("startIndex", String(start));
    pageParams.set("queryCount", "true");

    const page = await http.get<VroPage<T>>(`${path}?${formatQuery(pageParams)}`);
    const items = page.link ?? [];
    if (firstStart === undefined) firstStart = page.start;
    if (page.total !== undefined) reportedTotal = page.total;

    if (
      requestCount > 0 &&
      page.start !== undefined &&
      previousResponseStart !== undefined &&
      page.start <= previousResponseStart
    ) {
      break;
    }
    previousResponseStart = page.start;

    link.push(...items);

    if (items.length === 0) break;
    if (reportedTotal !== undefined && link.length >= reportedTotal) break;
    if (items.length < pageSize && reportedTotal === undefined) break;

    start = (page.start ?? start) + items.length;
  }

  return {
    link,
    ...(firstStart !== undefined ? { start: firstStart } : {}),
    total: reportedTotal ?? link.length,
  };
}

export async function getAllAutomationPages<T>(
  http: VroHttpClient,
  path: string,
  baseUrl: string,
  params: URLSearchParams = new URLSearchParams(),
  options: { pageSize?: number } = {},
): Promise<AutomationPageResult<T>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const content: T[] = [];
  let reportedTotal: number | undefined;
  let totalPages: number | undefined;

  for (let pageNumber = 0; pageNumber < MAX_PAGE_REQUESTS; pageNumber += 1) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("page", String(pageNumber));
    pageParams.set("size", String(pageSize));

    const page = await http.get<AutomationPage<T>>(
      `${path}?${formatQuery(pageParams)}`,
      baseUrl,
    );
    const items = page.content ?? [];
    if (page.totalElements !== undefined) reportedTotal = page.totalElements;
    if (page.totalPages !== undefined) totalPages = page.totalPages;

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

  return {
    content,
    numberOfElements: content.length,
    totalElements: reportedTotal ?? content.length,
  };
}
