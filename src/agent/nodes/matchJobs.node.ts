import type { JobAgentDependencies } from "../dependencies.js";
import type { JobAgentState } from "../state.js";

export function createMatchJobsNode(dependencies: JobAgentDependencies) {
  return async (state: JobAgentState): Promise<Partial<JobAgentState>> => {
    if (!state.profile) throw new Error("CandidateProfile is unavailable; matching cannot continue.");
    console.log(`[matchJobs] Sending ${state.detailedJobs.length} detailed Naukri Direct jobs to AI matching...`);
    const matches = await dependencies.matchJobs(state.profile, state.detailedJobs);
    await dependencies.saveMatchResults(matches);
    const failed = state.detailedJobs.length - matches.length;
    console.log(`[matchJobs] ${matches.length}/${state.detailedJobs.length} analyzed`);
    return { matches, errors: failed > 0 ? [`${failed} job matching analysis(es) failed`] : [] };
  };
}
