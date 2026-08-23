import type { JobAgentState, JobAgentSummary } from "../state.js";

export function summarize(state: Pick<JobAgentState, "jobs" | "directJobs" | "externalJobs" | "walkInJobs" | "unknownJobs" | "rankedMatches">): JobAgentSummary {
  const scores = state.rankedMatches.map((match) => match.overallScore);
  const summary: JobAgentSummary = {
    totalJobs: state.jobs.length,
    directJobs: state.directJobs.length,
    externalJobs: state.externalJobs.length,
    walkInJobs: state.walkInJobs.length,
    unknownJobs: state.unknownJobs.length,
    analyzedJobs: state.rankedMatches.length,
    apply: state.rankedMatches.filter((match) => match.recommendation === "APPLY").length,
    review: state.rankedMatches.filter((match) => match.recommendation === "REVIEW").length,
    skip: state.rankedMatches.filter((match) => match.recommendation === "SKIP").length,
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
