import { isHiristUrl, type HiristJobDetailRaw } from "./api.js";
import type { DetailedJob } from "./getJobDetails.js";

export type ApplicationType = "HIRIST_DIRECT" | "EXTERNAL_COMPANY" | "WALK_IN" | "UNKNOWN";
export type ApplicationTypeDetection = {
  applicationType: ApplicationType;
  applicationLabel?: string;
  externalApplicationUrl?: string;
  /** Hirist routes Apply to /job/<id>/screening (assessment or video round) before submission. */
  screeningRequired?: boolean;
};

/**
 * Read-only classification from Hirist's job-detail payload. A job is direct
 * only when it is live and has no off-platform apply URL.
 */
export function classifyHiristJob(detail: HiristJobDetailRaw | null): ApplicationTypeDetection {
  if (!detail) return { applicationType: "UNKNOWN", applicationLabel: "Job not found" };
  if (detail.hasExpired || detail.permanentlyRemoved || detail.active === 0) {
    return { applicationType: "UNKNOWN", applicationLabel: "Expired or inactive" };
  }
  const applyUrl = detail.applyUrl?.trim();
  if (applyUrl && !isHiristUrl(applyUrl)) {
    return { applicationType: "EXTERNAL_COMPANY", applicationLabel: "Apply on company site", externalApplicationUrl: applyUrl };
  }
  if (/\bwalk[\s-]?in\b/i.test(detail.title ?? "")) return { applicationType: "WALK_IN", applicationLabel: "Walk-in" };
  const screeningRequired = (Boolean(detail.assessmentFlags) && !detail.assessmentCompleted) || Boolean(detail.mediaResume);
  return { applicationType: "HIRIST_DIRECT", applicationLabel: "Apply", screeningRequired };
}

export function partitionJobsByApplicationType(jobs: DetailedJob[]) {
  return {
    directJobs: jobs.filter((job) => job.applicationType === "HIRIST_DIRECT"),
    externalJobs: jobs.filter((job) => job.applicationType === "EXTERNAL_COMPANY"),
    walkInJobs: jobs.filter((job) => job.applicationType === "WALK_IN"),
    unknownJobs: jobs.filter((job) => job.applicationType === "UNKNOWN"),
  };
}
