import type { JobAgentDependencies } from "../dependencies.js";
import type { JobAgentState } from "../state.js";

export function createSearchJobsNode(dependencies: JobAgentDependencies) {
  return async (_state: JobAgentState): Promise<Partial<JobAgentState>> => {
    console.log("[searchJobs] Searching Frontend Developer / Pune");
    const jobs = await dependencies.searchJobs();
    console.log(`[searchJobs] Found ${jobs.length}`);
    return { jobs };
  };
}
