import type { Page } from "playwright";
import { isNaukriAuthenticated } from "./auth.js";
import { detectApplicationType, type ApplicationType } from "./applicationType.js";
import {
  extractJobsFromCurrentPage,
  getNextSearchPageUrl,
  openSearchResultsPage,
  startJobSearch,
  type Job,
} from "./searchJobs.js";

export type DiscoveryConfig = {
  keyword: string;
  location: string;
  targetDirectJobs: number;
  maxJobsToInspect: number;
  maxPages: number;
};

export type ApplicationInspection = {
  job: Job;
  applicationType: ApplicationType;
  applicationLabel?: string;
  externalApplicationUrl?: string;
};

export type ManualJob = Job & {
  applicationType: Exclude<ApplicationType, "NAUKRI_DIRECT">;
  applicationLabel?: string;
  externalApplicationUrl?: string;
};

export type DirectJobDiscoveryResult = {
  directJobs: Job[];
  manualJobs: ManualJob[];
  inspectedJobs: number;
  pagesVisited: number;
  directCount: number;
  externalCount: number;
  walkInCount: number;
  unknownCount: number;
};

export type DiscoveryPage = { jobs: Job[]; nextPageToken: string | null };
export type DiscoveryDependencies = {
  loadFirstPage: () => Promise<DiscoveryPage | null>;
  loadPage: (token: string) => Promise<DiscoveryPage | null>;
  inspect: (job: Job) => Promise<ApplicationInspection>;
};

function validateConfig(config: DiscoveryConfig): void {
  for (const [name, value] of Object.entries({ targetDirectJobs: config.targetDirectJobs,
    maxJobsToInspect: config.maxJobsToInspect, maxPages: config.maxPages })) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  }
}

function identity(job: Job): string {
  return job.jobUrl.match(/-(\d+)\/?(?:\?.*)?$/)?.[1] ?? job.jobUrl;
}

export async function discoverDirectJobsCore(
  config: DiscoveryConfig,
  dependencies: DiscoveryDependencies
): Promise<DirectJobDiscoveryResult> {
  validateConfig(config);
  const result: DirectJobDiscoveryResult = { directJobs: [], manualJobs: [], inspectedJobs: 0,
    pagesVisited: 0, directCount: 0, externalCount: 0, walkInCount: 0, unknownCount: 0 };
  const seen = new Set<string>();
  let page = await dependencies.loadFirstPage();

  while (page && result.pagesVisited < config.maxPages) {
    result.pagesVisited += 1;
    console.log(`\nPage ${result.pagesVisited}\n`);
    for (const job of page.jobs) {
      if (result.directCount >= config.targetDirectJobs || result.inspectedJobs >= config.maxJobsToInspect) break;
      const key = identity(job);
      if (seen.has(key)) continue;
      seen.add(key);
      const inspection = await dependencies.inspect(job);
      result.inspectedJobs += 1;
      if (inspection.applicationType === "NAUKRI_DIRECT") {
        result.directJobs.push(job);
        result.directCount += 1;
      } else {
        result.manualJobs.push({ ...job, applicationType: inspection.applicationType,
          applicationLabel: inspection.applicationLabel, externalApplicationUrl: inspection.externalApplicationUrl });
        if (inspection.applicationType === "EXTERNAL_COMPANY") result.externalCount += 1;
        else if (inspection.applicationType === "WALK_IN") result.walkInCount += 1;
        else result.unknownCount += 1;
      }
      console.log(`[${result.inspectedJobs}/${config.maxJobsToInspect}] ${job.title} - ${inspection.applicationType}`);
      console.log(`Direct jobs: ${result.directCount}/${config.targetDirectJobs}`);
    }
    if (result.directCount >= config.targetDirectJobs || result.inspectedJobs >= config.maxJobsToInspect ||
      result.pagesVisited >= config.maxPages || !page.nextPageToken) break;
    page = await dependencies.loadPage(page.nextPageToken);
  }
  return result;
}

export async function inspectApplicationType(page: Page, job: Job): Promise<ApplicationInspection> {
  await page.goto(job.jobUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const currentUrl = new URL(page.url());
  if (currentUrl.hostname !== "www.naukri.com" || /login|register/i.test(currentUrl.pathname)) {
    return { job, applicationType: "UNKNOWN" };
  }
  if (!(await isNaukriAuthenticated(page, 30_000))) return { job, applicationType: "UNKNOWN" };
  await page.getByText("Job description", { exact: true }).first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
  const applicationContainer = page.locator('[class^="styles_jhc__apply-button-container"]:visible').first();
  await applicationContainer.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  return { job, ...(await detectApplicationType(page)) };
}

async function snapshotResultsPage(page: Page): Promise<DiscoveryPage> {
  return { jobs: await extractJobsFromCurrentPage(page), nextPageToken: await getNextSearchPageUrl(page) };
}

export async function discoverDirectJobs(page: Page, config: DiscoveryConfig): Promise<DirectJobDiscoveryResult> {
  console.log("Starting direct-job discovery...");
  console.log(`Target direct jobs: ${config.targetDirectJobs}`);
  console.log(`Maximum jobs to inspect: ${config.maxJobsToInspect}`);
  return discoverDirectJobsCore(config, {
    loadFirstPage: async () => (await startJobSearch(page, config.keyword, config.location)) ? snapshotResultsPage(page) : null,
    loadPage: async (url) => (await openSearchResultsPage(page, url)) ? snapshotResultsPage(page) : null,
    inspect: (job) => inspectApplicationType(page, job),
  });
}
