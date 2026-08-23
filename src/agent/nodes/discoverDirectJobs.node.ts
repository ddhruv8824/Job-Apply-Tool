import type { JobAgentDependencies } from "../dependencies.js";
import type { JobAgentState } from "../state.js";

export function createDiscoverDirectJobsNode(dependencies: JobAgentDependencies) {
  return async (_state: JobAgentState): Promise<Partial<JobAgentState>> => {
    console.log("[discoverDirectJobs] Starting");
    const result = await dependencies.discoverDirectJobs();
    console.log(`[discoverDirectJobs] Inspected ${result.inspectedJobs} across ${result.pagesVisited} page(s)`);
    console.log(`[discoverDirectJobs] Direct=${result.directCount} Manual=${result.manualJobs.length}`);
    const { directJobs, manualJobs, ...discovery } = result;
    return { jobs: [...directJobs, ...manualJobs], directJobs, manualJobs, discovery };
  };
}
