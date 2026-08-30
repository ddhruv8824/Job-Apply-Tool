import type { ReadyToApplyJob } from "./application.js";
import { APPLICATION_MINIMUM_SCORE } from "./application.js";

export const DEFAULT_AUTO_APPLY_DAILY_LIMIT = 3;
export const DEFAULT_AUTO_APPLY_RUN_LIMIT = 3;
export const HARD_AUTO_APPLY_LIMIT = 5;

export type AutoApplyPolicy = {
  enabled: boolean;
  dailyLimit: number;
  runLimit: number;
  minimumScore: number;
};

export type AutoApplyEligibility = { eligible: boolean; reasons: string[] };

function enabled(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === "true";
}

function boundedLimit(name: string, raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return Math.min(value, HARD_AUTO_APPLY_LIMIT);
}

export function getAutoApplyPolicy(environment: NodeJS.ProcessEnv = process.env): AutoApplyPolicy {
  return {
    enabled: enabled(environment.AUTO_APPLY_ENABLED),
    dailyLimit: boundedLimit("AUTO_APPLY_DAILY_LIMIT", environment.AUTO_APPLY_DAILY_LIMIT, DEFAULT_AUTO_APPLY_DAILY_LIMIT),
    runLimit: boundedLimit("AUTO_APPLY_RUN_LIMIT", environment.AUTO_APPLY_RUN_LIMIT, DEFAULT_AUTO_APPLY_RUN_LIMIT),
    minimumScore: APPLICATION_MINIMUM_SCORE,
  };
}

export function evaluateAutoApplyEligibility(input: {
  candidate: ReadyToApplyJob;
  databaseStatus?: string | null;
  policy: AutoApplyPolicy;
  databaseHealthy: boolean;
  cdpHealthy: boolean;
  authenticated: boolean;
  dailyAllowance: number;
  runAllowance: number;
}): AutoApplyEligibility {
  const reasons: string[] = [];
  if (!input.policy.enabled) reasons.push("AUTO_APPLY_DISABLED");
  if (!input.databaseHealthy) reasons.push("DATABASE_UNAVAILABLE");
  if (!input.cdpHealthy) reasons.push("CDP_UNAVAILABLE");
  if (!input.authenticated) reasons.push("AUTH_REQUIRED");
  if (input.dailyAllowance <= 0) reasons.push("DAILY_LIMIT_REACHED");
  if (input.runAllowance <= 0) reasons.push("RUN_LIMIT_REACHED");
  if (input.candidate.job.applicationType !== "NAUKRI_DIRECT") reasons.push("APPLICATION_TYPE_NOT_DIRECT");
  if (input.candidate.match.recommendation !== "APPLY") reasons.push("RECOMMENDATION_NOT_APPLY");
  if (input.candidate.match.overallScore < input.policy.minimumScore) reasons.push("SCORE_BELOW_THRESHOLD");
  if (input.databaseStatus === "APPLIED") reasons.push("STATUS_APPLIED");
  if (input.databaseStatus === "ALREADY_APPLIED") reasons.push("STATUS_ALREADY_APPLIED");
  return { eligible: reasons.length === 0, reasons };
}

export function rankAutoApplyCandidates(jobs: ReadyToApplyJob[]): ReadyToApplyJob[] {
  return [...jobs].sort((left, right) => right.match.overallScore - left.match.overallScore);
}
