import type { HiristClient } from "./api.js";
import { classifyHiristJob, type ApplicationType } from "./applicationType.js";
import { resolveLocationIds } from "./locations.js";
import { searchJobsPage, type Job } from "./searchJobs.js";

export type DiscoveryConfig = {
  keyword: string;
  /** Comma-separated Hirist locations, e.g. "Pune" or "Pune, Remote". Empty means anywhere. */
  location: string;
  minExperience?: number;
  maxExperience?: number;
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
  applicationType: Exclude<ApplicationType, "HIRIST_DIRECT">;
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
  return job.jobId ?? job.jobUrl.match(/-(\d+)\/?(?:\?.*)?$/)?.[1] ?? job.jobUrl;
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
      if (inspection.applicationType === "HIRIST_DIRECT") {
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

/** Read-only: classifies a job from Hirist's detail API without opening the page. */
export async function inspectApplicationType(client: HiristClient, job: Job): Promise<ApplicationInspection> {
  if (!job.jobId) return { job, applicationType: "UNKNOWN" };
  return { job, ...classifyHiristJob(await client.jobDetail(job.jobId)) };
}

export async function discoverDirectJobs(client: HiristClient, config: DiscoveryConfig): Promise<DirectJobDiscoveryResult> {
  const query = { keyword: config.keyword, locationIds: resolveLocationIds(config.location),
    minExperience: config.minExperience, maxExperience: config.maxExperience };
  console.log("Starting Hirist direct-job discovery...");
  console.log(`Keyword: ${config.keyword}`);
  console.log(`Location: ${config.location || "Anywhere"}`);
  console.log(`Target direct jobs: ${config.targetDirectJobs}`);
  console.log(`Maximum jobs to inspect: ${config.maxJobsToInspect}`);
  const loadPage = async (token: string) => {
    const page = await searchJobsPage(client, query, Number(token));
    return page.jobs.length ? page : null;
  };
  return discoverDirectJobsCore(config, {
    loadFirstPage: () => loadPage("0"),
    loadPage,
    inspect: (job) => inspectApplicationType(client, job),
  });
}
