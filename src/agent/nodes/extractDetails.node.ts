import type { JobAgentDependencies } from "../dependencies.js";
import type { JobAgentState } from "../state.js";

export function createExtractDetailsNode(dependencies: JobAgentDependencies) {
  return async (state: JobAgentState): Promise<Partial<JobAgentState>> => {
    console.log(`[extractJobDetails] Extracting full details for ${state.directJobs.length} direct jobs only`);
    const detailedJobs = await dependencies.extractJobDetails(state.directJobs);
    const failed = state.directJobs.length - detailedJobs.length;
    console.log(`[extractJobDetails] ${detailedJobs.length}/${state.directJobs.length} detailed`);
    return { detailedJobs, errors: failed > 0 ? [`${failed} job detail extraction(s) failed`] : [] };
  };
}
