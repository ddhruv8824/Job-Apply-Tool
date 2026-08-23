import path from "node:path";
import type { Page } from "playwright";
import { ensureNaukriAuthenticated } from "../naukri/auth.js";
import { connectToChrome } from "../naukri/browser.js";
import { getJobsDetails } from "../naukri/getJobDetails.js";
import { searchJobs } from "../naukri/searchJobs.js";
import { matchJobs } from "../matching/matchJobs.js";
import { extractResumeText } from "../resume/parseResume.js";
import { getCandidateProfile } from "../resume/getCandidateProfile.js";
import type { JobAgentDependencies } from "./dependencies.js";

const config = { resumePath: path.resolve("data", "DhruvCVU.pdf"), keyword: "Frontend Developer", location: "Pune", maxJobs: 10 };

export function createProductionDependencies(): JobAgentDependencies {
  let page: Page | undefined;

  async function getAuthenticatedPage(): Promise<Page> {
    if (page) return page;
    const session = await connectToChrome();
    page = session.page;
    await ensureNaukriAuthenticated(page);
    return page;
  }

  return {
    loadProfile: async () => getCandidateProfile(await extractResumeText(config.resumePath)),
    searchJobs: async () => searchJobs(await getAuthenticatedPage(), config.keyword, config.location, config.maxJobs),
    extractJobDetails: async (jobs) => getJobsDetails(await getAuthenticatedPage(), jobs),
    matchJobs,
  };
}
