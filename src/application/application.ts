import type { DetailedJob } from "../hirist/getJobDetails.js";
import type { MatchResult } from "../matching/match.schema.js";

export type ReadyToApplyJob = { job: DetailedJob; match: MatchResult };
export const APPLICATION_MINIMUM_SCORE = 85;
export type ApplyResult = {
  status: "APPLIED" | "QUESTIONNAIRE" | "ALREADY_APPLIED" | "AUTH_REQUIRED" | "UNKNOWN" | "DRY_RUN";
  message?: string;
  visibleQuestions?: number;
  interactionOccurred?: boolean;
  reason?: "AUTH_REQUIRED" | "IDENTITY_MISMATCH" | "LIVE_RECLASSIFIED" | "DIRECT_CONTROL_MISSING" | "HUMAN_REQUIRED" | "EXTERNAL_REDIRECT" | "UNKNOWN_POST_CLICK" | "PROFILE_INCOMPLETE" | "REVIEW_CONFIRM_MISSING";
  needsInput?: boolean;
};

export function isEligibleForApplication(job: DetailedJob, match: MatchResult): boolean {
  return job.applicationType === "HIRIST_DIRECT" && (match.recommendation === "APPLY" || match.recommendation === "REVIEW") && match.overallScore >= 70;
}

export function selectReadyToApplyJobs(jobs: DetailedJob[], matches: MatchResult[]): ReadyToApplyJob[] {
  const jobsByIdentity = new Map<string, DetailedJob>();
  for (const job of jobs) {
    jobsByIdentity.set(job.jobId ?? job.jobUrl, job);
    jobsByIdentity.set(job.jobUrl, job);
  }
  return matches
    .map((match) => ({ match, job: jobsByIdentity.get(match.jobId ?? match.jobUrl) ?? jobsByIdentity.get(match.jobUrl) }))
    .filter((value): value is ReadyToApplyJob => Boolean(value.job) && isEligibleForApplication(value.job!, value.match))
    .sort((left, right) => right.match.overallScore - left.match.overallScore);
}

export function isDryRun(environment = process.env): boolean {
  return environment.APPLY_DRY_RUN?.trim().toLowerCase() !== "false";
}
