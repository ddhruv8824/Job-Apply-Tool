import { HIRIST_ORIGIN, type HiristClient, type HiristSearchJobRaw, type HiristSearchQuery } from "./api.js";

export type Job = {
  jobId?: string;
  title: string;
  company: string;
  location: string;
  experience?: string;
  jobUrl: string;
};

export type SearchResultsPage = { jobs: Job[]; nextPageToken: string | null };

/** Mirrors the site's own slug so fallback URLs resolve to the same job page. */
function slugify(value: string): string {
  return value.toLowerCase().replace(/&/g, "-and-").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function hiristJobUrl(raw: Pick<HiristSearchJobRaw, "id" | "title" | "jobDetailUrl">): string {
  if (raw.jobDetailUrl) {
    try {
      const url = new URL(raw.jobDetailUrl);
      url.search = "";
      return url.toString();
    } catch { /* Fall through to the constructed URL. */ }
  }
  return `${HIRIST_ORIGIN}/j/${slugify(raw.title)}-${raw.id}`;
}

export function formatExperience(min?: number, max?: number): string | undefined {
  if (min === undefined && max === undefined) return undefined;
  if (max === undefined || max === min) return `${min ?? 0} yrs`;
  return `${min ?? 0} - ${max} yrs`;
}

export function formatLocation(raw: HiristSearchJobRaw): string {
  const names = (raw.locations ?? raw.location ?? []).map((item) => item.name).filter(Boolean);
  if (names.length) return names.join("/");
  return raw.createdByAlias?.trim() || "Not specified";
}

/** Returns null when a row lacks the fields needed to track and open the job. */
export function mapSearchJob(raw: HiristSearchJobRaw): Job | null {
  const title = raw.title?.trim();
  if (!raw.id || !title) return null;
  return {
    jobId: String(raw.id),
    title,
    company: raw.companyData?.companyName?.trim() || (raw.confidential ? "Confidential" : "Not disclosed"),
    location: formatLocation(raw),
    experience: formatExperience(raw.min, raw.max),
    jobUrl: hiristJobUrl(raw),
  };
}

/**
 * Reads one page of Hirist search results through the API. Page tokens are
 * zero-based page numbers. Read-only: never opens a job or clicks anything.
 */
export async function searchJobsPage(client: HiristClient, query: HiristSearchQuery, page: number): Promise<SearchResultsPage> {
  const result = await client.search(query, page);
  const jobs: Job[] = [];
  for (const raw of result.jobs) {
    const job = mapSearchJob(raw);
    if (job) jobs.push(job);
    else console.warn("Skipped a search result with no id or title.");
  }
  return { jobs, nextPageToken: result.hasMore && result.jobs.length > 0 ? String(page + 1) : null };
}
