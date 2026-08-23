import type { JobAgentState } from "../state.js";

export async function rankJobsNode(state: JobAgentState): Promise<Partial<JobAgentState>> {
  const rankedMatches = [...state.matches].sort((left, right) => right.overallScore - left.overallScore);
  console.log(`[rankJobs] Ranked ${rankedMatches.length}`);
  return { rankedMatches };
}
