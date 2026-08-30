import type { ApplicationStatus } from "../generated/prisma/enums.js";

export const PERMANENT_APPLICATION_STATUSES = ["APPLIED", "ALREADY_APPLIED"] as const;

export function shouldSkipBecauseAlreadyApplied(status: string | null | undefined): boolean {
  return status === "APPLIED" || status === "ALREADY_APPLIED";
}

export function statusForRecommendation(recommendation: "APPLY" | "REVIEW" | "SKIP"): ApplicationStatus {
  if (recommendation === "APPLY") return "READY_TO_APPLY";
  return recommendation;
}
