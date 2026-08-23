import path from "node:path";
import type { Page } from "playwright";
import { ensureNaukriAuthenticated } from "../naukri/auth.js";
import { connectToChrome } from "../naukri/browser.js";
import { getJobsDetails } from "../naukri/getJobDetails.js";
import { discoverDirectJobs, type DiscoveryConfig } from "../naukri/discoverDirectJobs.js";
import { matchJobs } from "../matching/matchJobs.js";
import { extractResumeText } from "../resume/parseResume.js";
import { getCandidateProfile } from "../resume/getCandidateProfile.js";
import type { JobAgentDependencies } from "./dependencies.js";

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}
const resumePath = path.resolve("data", "DhruvCVU.pdf");

export type ProductionJobAgentDependencies = JobAgentDependencies & { getAuthenticatedPage: () => Promise<Page> };

export function createProductionDependencies(): ProductionJobAgentDependencies {
  let page: Page | undefined;
  const discoveryConfig: DiscoveryConfig = {
    keyword: process.env.JOB_KEYWORD?.trim() || "Frontend Developer",
    location: process.env.JOB_LOCATION?.trim() || "Pune",
    targetDirectJobs: positiveInteger("TARGET_DIRECT_JOBS", 10),
    maxJobsToInspect: positiveInteger("MAX_JOBS_TO_INSPECT", 60),
    maxPages: positiveInteger("MAX_SEARCH_PAGES", 5),
  };

  async function getAuthenticatedPage(): Promise<Page> {
    if (page) return page;
    const session = await connectToChrome();
    page = session.page;
    await ensureNaukriAuthenticated(page);
    return page;
  }

  return {
    getAuthenticatedPage,
    loadProfile: async () => getCandidateProfile(await extractResumeText(resumePath)),
    discoverDirectJobs: async () => discoverDirectJobs(await getAuthenticatedPage(), discoveryConfig),
    extractJobDetails: async (jobs) => getJobsDetails(await getAuthenticatedPage(), jobs),
    matchJobs,
  };
}
