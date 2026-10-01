import path from "node:path";
import type { Page } from "playwright";
import { createHiristClient, pageTransport, type HiristClient } from "../hirist/api.js";
import { ensureHiristAuthenticated } from "../hirist/auth.js";
import { connectToChrome } from "../hirist/browser.js";
import { getDiscoveryConfig } from "../hirist/config.js";
import { getJobsDetails } from "../hirist/getJobDetails.js";
import { discoverDirectJobs } from "../hirist/discoverDirectJobs.js";
import { matchJobs } from "../matching/matchJobs.js";
import { extractResumeText } from "../resume/parseResume.js";
import { getCandidateProfile } from "../resume/getCandidateProfile.js";
import type { JobAgentDependencies } from "./dependencies.js";
import { filterPreviouslyApplied, persistDiscovery, saveMatchResults } from "../db/trackingService.js";

const resumePath = path.resolve("data", "DhruvCVU.pdf");

export type ProductionJobAgentDependencies = JobAgentDependencies & { getAuthenticatedPage: () => Promise<Page> };

export function createProductionDependencies(existingPage?: Page): ProductionJobAgentDependencies {
  let page: Page | undefined = existingPage;
  let client: HiristClient | undefined;
  const discoveryConfig = getDiscoveryConfig();

  async function getAuthenticatedPage(): Promise<Page> {
    if (page) return page;
    const session = await connectToChrome();
    page = session.page;
    await ensureHiristAuthenticated(page);
    return page;
  }

  /** One client per run so job details fetched during discovery are reused for extraction. */
  async function getClient(): Promise<HiristClient> {
    client ??= createHiristClient(pageTransport(await getAuthenticatedPage()));
    return client;
  }

  return {
    getAuthenticatedPage,
    loadProfile: async () => getCandidateProfile(await extractResumeText(resumePath)),
    discoverDirectJobs: async () => discoverDirectJobs(await getClient(), discoveryConfig),
    extractJobDetails: async (jobs) => getJobsDetails(await getClient(), jobs),
    matchJobs,
    persistDiscovery,
    filterPreviouslyApplied,
    saveMatchResults,
  };
}
