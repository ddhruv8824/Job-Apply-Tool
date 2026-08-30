import type { JobAgentState, JobAgentSummary } from "../state.js";

export function summarize(state: Pick<JobAgentState, "jobs" | "directJobs" | "discovery" | "rankedMatches" | "historyStats">): JobAgentSummary {
  const scores = state.rankedMatches.map((match) => match.overallScore);
  const summary: JobAgentSummary = {
    totalJobs: state.jobs.length,
    directJobs: state.directJobs.length,
    externalJobs: state.discovery?.externalCount ?? 0,
    walkInJobs: state.discovery?.walkInCount ?? 0,
    unknownJobs: state.discovery?.unknownCount ?? 0,
    analyzedJobs: state.rankedMatches.length,
    apply: state.rankedMatches.filter((match) => match.recommendation === "APPLY").length,
    review: state.rankedMatches.filter((match) => match.recommendation === "REVIEW").length,
    skip: state.rankedMatches.filter((match) => match.recommendation === "SKIP").length,
    previouslyAppliedSkipped: state.historyStats?.previouslyAppliedSkipped ?? 0,
  };
  if (scores.length > 0) {
    summary.highestScore = Math.max(...scores);
    summary.averageScore = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  }
  return summary;
}

export async function buildSummaryNode(state: JobAgentState): Promise<Partial<JobAgentState>> {
  const summary = summarize(state);
  console.log(`[buildSummary] APPLY=${summary.apply} REVIEW=${summary.review} SKIP=${summary.skip}`);
  return { summary };
}
