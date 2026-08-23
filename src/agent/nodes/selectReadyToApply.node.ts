import { selectReadyToApplyJobs } from "../../application/application.js";
import type { JobAgentState } from "../state.js";

export async function selectReadyToApplyNode(state: JobAgentState): Promise<Partial<JobAgentState>> {
  const readyToApplyJobs = selectReadyToApplyJobs(state.detailedJobs, state.rankedMatches);
  const selectedApplication = readyToApplyJobs[0];
  console.log(`[selectReadyToApply] Eligible jobs: ${readyToApplyJobs.length}`);
  if (selectedApplication) console.log(`[selectReadyToApply] Selected ${selectedApplication.job.title} - ${selectedApplication.match.overallScore}%`);
  else console.log("[selectReadyToApply] No Naukri Direct APPLY candidates found.");
  return { readyToApplyJobs, selectedApplication };
}
