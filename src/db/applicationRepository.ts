import type { ApplicationStatus } from "../generated/prisma/enums.js";
import type { ApplyResult } from "../application/application.js";
import type { MatchResult } from "../matching/match.schema.js";
import type { Job } from "../naukri/searchJobs.js";
import type { DatabaseClient } from "./prisma.js";
import { prisma } from "./prisma.js";
import { getJobHistory } from "./jobRepository.js";
import { sanitizeOperationalError } from "./sanitize.js";
import { shouldSkipBecauseAlreadyApplied, statusForRecommendation } from "./status.js";

export async function getApplicationByJob(job: Pick<Job, "jobUrl"> & { jobId?: string }, db: DatabaseClient = prisma) {
  return (await getJobHistory(job, db))?.application ?? null;
}

export async function hasAlreadyApplied(job: Pick<Job, "jobUrl"> & { jobId?: string }, db: DatabaseClient = prisma): Promise<boolean> {
  return shouldSkipBecauseAlreadyApplied((await getApplicationByJob(job, db))?.status);
}

export async function ensureApplicationStatus(jobId: string, status: ApplicationStatus, db: DatabaseClient = prisma) {
  const existing = await db.application.findUnique({ where: { jobId } });
  if (shouldSkipBecauseAlreadyApplied(existing?.status)) return existing;
  return db.application.upsert({
    where: { jobId },
    create: { jobId, status },
    update: { status },
  });
}

export async function saveMatchResult(match: MatchResult, db: DatabaseClient = prisma) {
  const history = await getJobHistory({ jobId: match.jobId, jobUrl: match.jobUrl }, db);
  if (!history) throw new Error(`Cannot save match result for untracked job: ${match.jobUrl}`);
  const existing = await db.application.findUnique({ where: { jobId: history.id } });
  if (shouldSkipBecauseAlreadyApplied(existing?.status)) return existing;
  return db.application.upsert({
    where: { jobId: history.id },
    create: { jobId: history.id, status: statusForRecommendation(match.recommendation), matchScore: match.overallScore, recommendation: match.recommendation },
    update: { status: statusForRecommendation(match.recommendation), matchScore: match.overallScore, recommendation: match.recommendation, lastError: null },
  });
}

export async function recordApplicationAttempt(job: Pick<Job, "jobUrl"> & { jobId?: string }, db: DatabaseClient = prisma, mode = "INTERACTIVE") {
  const history = await getJobHistory(job, db);
  if (!history) throw new Error(`Cannot record application attempt for untracked job: ${job.jobUrl}`);
  if (shouldSkipBecauseAlreadyApplied(history.application?.status)) throw new Error("Permanent application history blocks this job.");
  const attemptedAt = new Date();
  return db.$transaction(async (transaction) => {
    const application = await transaction.application.upsert({
      where: { jobId: history.id },
      create: { jobId: history.id, status: "READY_TO_APPLY", attemptCount: 1, lastAttemptAt: attemptedAt },
      update: { attemptCount: { increment: 1 }, lastAttemptAt: attemptedAt },
    });
    await transaction.applicationAttempt.create({ data: { applicationId: application.id, attemptedAt, mode } });
    return application;
  });
}

/** Prisma stores DateTime instants in UTC; these boundaries represent the host's local calendar day. */
export function localDayUtcRange(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start, end };
}

export async function countApplicationAttemptsSince(start: Date, end = new Date(), db: DatabaseClient = prisma): Promise<number> {
  return db.applicationAttempt.count({ where: { attemptedAt: { gte: start, lt: end } } });
}

export async function countApplicationAttemptsToday(now = new Date(), db: DatabaseClient = prisma): Promise<number> {
  const { start, end } = localDayUtcRange(now);
  return countApplicationAttemptsSince(start, end, db);
}

export async function saveApplyResult(job: Pick<Job, "jobUrl"> & { jobId?: string }, result: ApplyResult, db: DatabaseClient = prisma) {
  if (result.status === "DRY_RUN") return getApplicationByJob(job, db);
  const history = await getJobHistory(job, db);
  if (!history) throw new Error(`Cannot save application result for untracked job: ${job.jobUrl}`);
  const status: ApplicationStatus = result.status;
  return db.application.upsert({
    where: { jobId: history.id },
    create: { jobId: history.id, status, questionnaireDetected: status === "QUESTIONNAIRE", appliedAt: status === "APPLIED" ? new Date() : null },
    update: { status, questionnaireDetected: status === "QUESTIONNAIRE" ? true : undefined, appliedAt: status === "APPLIED" ? new Date() : undefined, lastError: null },
  });
}

export async function saveUnattendedApplyResult(job: Pick<Job, "jobUrl"> & { jobId?: string }, result: ApplyResult, db: DatabaseClient = prisma) {
  if (result.status === "QUESTIONNAIRE" && result.needsInput) {
    const history = await getJobHistory(job, db);
    if (!history) throw new Error(`Cannot save questionnaire result for untracked job: ${job.jobUrl}`);
    await db.application.upsert({
      where: { jobId: history.id },
      create: { jobId: history.id, status: "NEEDS_INPUT", questionnaireDetected: true },
      update: { status: "NEEDS_INPUT", questionnaireDetected: true, lastError: null },
    });
    return;
  }
  await saveApplyResult(job, result, db);
}

export async function saveQuestionnaireResult(job: Pick<Job, "jobUrl"> & { jobId?: string }, result: { status: string; message?: string }, db: DatabaseClient = prisma) {
  if (result.status === "DRY_RUN") return getApplicationByJob(job, db);
  const history = await getJobHistory(job, db);
  if (!history) throw new Error(`Cannot save questionnaire result for untracked job: ${job.jobUrl}`);
  let status: ApplicationStatus;
  if (result.status === "APPLIED") status = "APPLIED";
  else if (result.status === "NEEDS_INPUT" || result.status === "READY_FOR_REVIEW") status = "NEEDS_INPUT";
  else if (result.status === "AUTH_REQUIRED") status = "AUTH_REQUIRED";
  else if (result.status === "VALIDATION_FAILED") status = "FAILED";
  else status = "UNKNOWN";
  return db.application.upsert({
    where: { jobId: history.id },
    create: { jobId: history.id, status, questionnaireDetected: true, appliedAt: status === "APPLIED" ? new Date() : null, lastError: status === "FAILED" || status === "UNKNOWN" ? sanitizeOperationalError(result.message) : null },
    update: { status, questionnaireDetected: true, appliedAt: status === "APPLIED" ? new Date() : undefined, lastError: status === "FAILED" || status === "UNKNOWN" ? sanitizeOperationalError(result.message) : null },
  });
}

export async function saveApplicationFailure(job: Pick<Job, "jobUrl"> & { jobId?: string }, error: unknown, db: DatabaseClient = prisma) {
  const history = await getJobHistory(job, db);
  if (!history) return null;
  if (shouldSkipBecauseAlreadyApplied(history.application?.status)) return history.application;
  return db.application.upsert({ where: { jobId: history.id }, create: { jobId: history.id, status: "FAILED", lastError: sanitizeOperationalError(error) }, update: { status: "FAILED", lastError: sanitizeOperationalError(error) } });
}
