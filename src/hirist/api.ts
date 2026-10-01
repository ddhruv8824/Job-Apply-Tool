import type { Page } from "playwright";

/** Public site origin. Job pages live at `${HIRIST_ORIGIN}/j/<slug>-<id>`. */
export const HIRIST_ORIGIN = "https://www.hirist.tech";
/** JSON API used by the Hirist web app itself (cookie-authenticated). */
export const HIRIST_API = "https://gladiator.hirist.tech";
export const SEARCH_PAGE_SIZE = 20;

export type HiristTag = { id: number; name: string; isMandatory?: boolean };
export type HiristLocation = { id: number; name: string };

/** Subset of a /job/search result row that this tool relies on. */
export type HiristSearchJobRaw = {
  id: number;
  title: string;
  min?: number;
  max?: number;
  jobdesignation?: string;
  jobDetailUrl?: string;
  tags?: HiristTag[];
  locations?: HiristLocation[];
  location?: HiristLocation[];
  createdByAlias?: string;
  createdTimeMs?: number;
  workFromHome?: number;
  confidential?: number;
  companyData?: { companyName?: string } | null;
};

/** Subset of a /job/detail payload that this tool relies on. */
export type HiristJobDetailRaw = HiristSearchJobRaw & {
  introText?: string;
  applyUrl?: string;
  hasExpired?: boolean;
  active?: number;
  status?: number;
  permanentlyRemoved?: boolean;
  assessmentFlags?: number;
  assessmentCompleted?: boolean;
  mediaResume?: number;
  industry?: string;
  careerCompanyName?: string;
};

export type HiristSearchPage = { jobs: HiristSearchJobRaw[]; hasMore: boolean; totalJobs?: number };

export type HiristResponse = { status: number; body: unknown };
/** Performs one GET against the Hirist API and returns the parsed JSON body (or null). */
export type HiristTransport = (url: string) => Promise<HiristResponse>;

export function isHiristHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "hirist.tech" || host.endsWith(".hirist.tech");
}

export function isHiristUrl(url: string): boolean {
  try { return isHiristHost(new URL(url).hostname); } catch { return false; }
}

/** Job IDs are the trailing number of a /j/ URL, e.g. /j/acme-frontend-developer-1671060. */
export function extractHiristJobId(jobUrl: string): string | undefined {
  try {
    const url = new URL(jobUrl);
    if (!isHiristHost(url.hostname)) return undefined;
    return url.pathname.match(/^\/j\/(?:.*-)?(\d+)\/?$/)?.[1];
  } catch {
    return undefined;
  }
}

export type HiristSearchQuery = { keyword: string; locationIds: number[]; minExperience?: number; maxExperience?: number };

export function buildSearchUrl(query: HiristSearchQuery, page: number, size = SEARCH_PAGE_SIZE): string {
  const params = new URLSearchParams({ query: query.keyword, page: String(page), posting: "0", industry: "", size: String(size) });
  if (query.locationIds.length) params.set("loc", query.locationIds.join(","));
  if (query.minExperience !== undefined) params.set("minexp", String(query.minExperience));
  if (query.maxExperience !== undefined) params.set("maxexp", String(query.maxExperience));
  return `${HIRIST_API}/job/search?${params.toString()}`;
}

/** Plain Node fetch. Unauthenticated: suitable for read-only discovery checks only. */
export const nodeTransport: HiristTransport = async (url) => {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  return { status: response.status, body: await response.json().catch(() => null) };
};

/**
 * Runs the request inside the connected Chrome tab so the user's Hirist
 * session cookies are sent, exactly as the Hirist web app does.
 */
export function pageTransport(page: Page): HiristTransport {
  return async (url) => {
    if (!isHiristUrl(page.url())) throw new Error(`Hirist API requires a hirist.tech tab; current tab is ${page.url()}`);
    return page.evaluate(async (target) => {
      const response = await fetch(target, { credentials: "include", headers: { accept: "application/json" } });
      let body: unknown = null;
      try { body = await response.json(); } catch { /* Non-JSON bodies are reported as null. */ }
      return { status: response.status, body };
    }, url);
  };
}

function ok(status: number): boolean { return status >= 200 && status < 300; }

export type HiristClient = {
  search: (query: HiristSearchQuery, page: number) => Promise<HiristSearchPage>;
  /** Cached per client unless `fresh` is set; returns null for missing/removed jobs. */
  jobDetail: (jobId: string, options?: { fresh?: boolean }) => Promise<HiristJobDetailRaw | null>;
  isAuthenticated: () => Promise<boolean>;
};

export function createHiristClient(transport: HiristTransport, options: { minIntervalMs?: number } = {}): HiristClient {
  const minIntervalMs = options.minIntervalMs ?? Number(process.env.HIRIST_REQUEST_INTERVAL_MS ?? 400);
  const details = new Map<string, HiristJobDetailRaw | null>();
  let nextRequestAt = 0;

  async function get(url: string): Promise<HiristResponse> {
    const delay = nextRequestAt - Date.now();
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    try { return await transport(url); } finally { nextRequestAt = Date.now() + minIntervalMs; }
  }

  return {
    async search(query, page) {
      const response = await get(buildSearchUrl(query, page));
      if (!ok(response.status)) throw new Error(`Hirist search returned HTTP ${response.status}`);
      const body = response.body as { data?: unknown; hasMore?: boolean; totalJobs?: number } | null;
      if (!body || !Array.isArray(body.data)) throw new Error("Hirist search response had no data array");
      return { jobs: body.data as HiristSearchJobRaw[], hasMore: Boolean(body.hasMore), totalJobs: body.totalJobs };
    },
    async jobDetail(jobId, detailOptions = {}) {
      if (!detailOptions.fresh && details.has(jobId)) return details.get(jobId) ?? null;
      const response = await get(`${HIRIST_API}/job/detail?jobcode=${encodeURIComponent(jobId)}`);
      if (response.status === 404) { details.set(jobId, null); return null; }
      if (!ok(response.status)) throw new Error(`Hirist job detail returned HTTP ${response.status}`);
      const data = (response.body as { data?: HiristJobDetailRaw } | null)?.data ?? null;
      details.set(jobId, data);
      return data;
    },
    async isAuthenticated() {
      const first = await get(`${HIRIST_API}/auth/validate`);
      if (ok(first.status)) return true;
      if (first.status !== 401 && first.status !== 403) return false;
      // The web app refreshes an expired access cookie the same way before giving up.
      const refreshed = await get(`${HIRIST_API}/auth/refresh`);
      if (!ok(refreshed.status)) return false;
      return ok((await get(`${HIRIST_API}/auth/validate`)).status);
    },
  };
}
