import type { JobAgentDependencies } from "../dependencies.js";
import type { JobAgentState } from "../state.js";

export function createMatchJobsNode(dependencies: JobAgentDependencies) {
  return async (state: JobAgentState): Promise<Partial<JobAgentState>> => {
    if (!state.profile) throw new Error("CandidateProfile is unavailable; matching cannot continue.");
    console.log(`[matchJobs] Sending ${state.directJobs.length} Naukri Direct jobs to AI matching...`);
    const matches = await dependencies.matchJobs(state.profile, state.directJobs);
    const failed = state.directJobs.length - matches.length;
    console.log(`[matchJobs] ${matches.length}/${state.directJobs.length} analyzed`);
    return { matches, errors: failed > 0 ? [`${failed} job matching analysis(es) failed`] : [] };
  };
}
