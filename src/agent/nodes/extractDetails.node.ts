import type { JobAgentDependencies } from "../dependencies.js";
import type { JobAgentState } from "../state.js";

export function createExtractDetailsNode(dependencies: JobAgentDependencies) {
  return async (state: JobAgentState): Promise<Partial<JobAgentState>> => {
    console.log(`[extractJobDetails] Starting ${state.jobs.length} jobs`);
    const detailedJobs = await dependencies.extractJobDetails(state.jobs);
    const failed = state.jobs.length - detailedJobs.length;
    console.log(`[extractJobDetails] ${detailedJobs.length}/${state.jobs.length} detailed`);
    return { detailedJobs, errors: failed > 0 ? [`${failed} job detail extraction(s) failed`] : [] };
  };
}
