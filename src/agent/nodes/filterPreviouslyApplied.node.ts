import type { JobAgentDependencies } from "../dependencies.js";
import type { JobAgentState } from "../state.js";

export function createFilterPreviouslyAppliedNode(dependencies: JobAgentDependencies) {
  return async (state: JobAgentState): Promise<Partial<JobAgentState>> => {
    const result = await dependencies.filterPreviouslyApplied(state.directJobs);
    console.log(`[filterPreviouslyApplied] Permanently skipped ${result.previouslyAppliedJobs.length}; processable ${result.processableJobs.length}`);
    return {
      processableDirectJobs: result.processableJobs,
      previouslyAppliedJobs: result.previouslyAppliedJobs,
      historyStats: { previouslyAppliedSkipped: result.previouslyAppliedJobs.length },
    };
  };
}
