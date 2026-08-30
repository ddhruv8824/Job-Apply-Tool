import type { ApplyResult, ReadyToApplyJob } from "./application.js";
import { selectReadyToApplyJobs } from "./application.js";
import type { DetailedJob } from "../naukri/getJobDetails.js";
import type { MatchResult } from "../matching/match.schema.js";

export const DEFAULT_BATCH_MAX_APPLICATIONS = 3;
export const HARD_BATCH_MAX_APPLICATIONS = 5;

export type BatchJobStatus =
  | ApplyResult["status"]
  | "NEEDS_INPUT"
  | "SKIPPED_BY_USER"
  | "SKIPPED_BY_HISTORY"
  | "EXTERNAL_RECLASSIFIED"
  | "FAILED";

export type BatchApplicationResult = {
  candidates: number;
  attempted: number;
  applied: number;
  alreadyApplied: number;
  needsInput: number;
  skippedByUser: number;
  skippedByHistory: number;
  failed: number;
  stoppedEarly: boolean;
  stopReason?: string;
  results: Array<{ jobId?: string; title: string; company: string; status: BatchJobStatus }>;
};

export type BatchPrompts = {
  approveBatch: (jobs: ReadyToApplyJob[]) => Promise<string>;
  approveJob: (job: ReadyToApplyJob, index: number, total: number, databaseStatus: string | null) => Promise<string>;
};

export type BatchDependencies = {
  databaseHealthy: () => Promise<boolean>;
  getDatabaseStatus: (job: ReadyToApplyJob) => Promise<string | null>;
  hasAlreadyApplied: (job: ReadyToApplyJob) => Promise<boolean>;
  applyOnce: (job: ReadyToApplyJob, onAttempt: () => void) => Promise<ApplyResult>;
  persistApplyResult: (job: ReadyToApplyJob, result: ApplyResult) => Promise<void>;
  runQuestionnaire: (job: ReadyToApplyJob) => Promise<{ status: string }>;
  persistQuestionnaireResult: (job: ReadyToApplyJob, result: { status: string }) => Promise<void>;
  persistFailure: (job: ReadyToApplyJob, error: unknown) => Promise<void>;
};

export function getBatchMaxApplications(environment: NodeJS.ProcessEnv = process.env): number {
  const raw = environment.BATCH_MAX_APPLICATIONS?.trim();
  if (!raw) return DEFAULT_BATCH_MAX_APPLICATIONS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error("BATCH_MAX_APPLICATIONS must be a positive integer.");
  return Math.min(value, HARD_BATCH_MAX_APPLICATIONS);
}

export function isBatchDryRun(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.BATCH_DRY_RUN?.trim().toLowerCase() !== "false";
}

export function selectEligibleApplications(
  jobs: DetailedJob[],
  rankedMatches: MatchResult[],
  limit: number
): ReadyToApplyJob[] {
  const safeLimit = Math.min(Math.max(0, Math.trunc(limit)), HARD_BATCH_MAX_APPLICATIONS);
  return selectReadyToApplyJobs(jobs, rankedMatches).slice(0, safeLimit);
}

function accepted(value: string): boolean { return /^(?:yes|y)$/i.test(value.trim()); }
function skipped(value: string): boolean { return /^(?:no|skip)$/i.test(value.trim()); }
function stopped(value: string): boolean { return /^stop$/i.test(value.trim()); }
function externalReclassification(result: ApplyResult): boolean {
  return result.status === "UNKNOWN" && /application type changed to (?:EXTERNAL_COMPANY|WALK_IN|UNKNOWN)/i.test(result.message ?? "");
}

function emptyResult(candidates: number): BatchApplicationResult {
  return { candidates, attempted: 0, applied: 0, alreadyApplied: 0, needsInput: 0,
    skippedByUser: 0, skippedByHistory: 0, failed: 0, stoppedEarly: false, results: [] };
}

export async function runControlledBatch(options: {
  jobs: ReadyToApplyJob[];
  dryRun: boolean;
  prompts: BatchPrompts;
  dependencies: BatchDependencies;
}): Promise<BatchApplicationResult> {
  const result = emptyResult(options.jobs.length);
  if (!(await options.dependencies.databaseHealthy())) {
    result.stoppedEarly = true;
    result.stopReason = "DATABASE_UNAVAILABLE";
    return result;
  }
  if (options.dryRun || options.jobs.length === 0) return result;
  if (!accepted(await options.prompts.approveBatch(options.jobs))) {
    result.stoppedEarly = true;
    result.stopReason = "BATCH_CANCELLED";
    return result;
  }

  for (let index = 0; index < options.jobs.length; index += 1) {
    const item = options.jobs[index]!;
    if (!(await options.dependencies.databaseHealthy())) {
      result.stoppedEarly = true; result.stopReason = "DATABASE_UNAVAILABLE"; break;
    }
    let dbStatus: string | null;
    try { dbStatus = await options.dependencies.getDatabaseStatus(item); }
    catch { result.stoppedEarly = true; result.stopReason = "DATABASE_UNAVAILABLE"; break; }
    const decision = await options.prompts.approveJob(item, index, options.jobs.length, dbStatus);
    if (stopped(decision)) {
      result.stoppedEarly = true;
      result.stopReason = "STOPPED_BY_USER";
      break;
    }
    if (skipped(decision) || !accepted(decision)) {
      result.skippedByUser += 1;
      result.results.push({ jobId: item.job.jobId, title: item.job.title, company: item.job.company, status: "SKIPPED_BY_USER" });
      continue;
    }
    if (!(await options.dependencies.databaseHealthy())) {
      result.stoppedEarly = true; result.stopReason = "DATABASE_UNAVAILABLE"; break;
    }
    let blockedByHistory: boolean;
    try { blockedByHistory = await options.dependencies.hasAlreadyApplied(item); }
    catch { result.stoppedEarly = true; result.stopReason = "DATABASE_UNAVAILABLE"; break; }
    if (blockedByHistory) {
      result.skippedByHistory += 1;
      result.results.push({ jobId: item.job.jobId, title: item.job.title, company: item.job.company, status: "SKIPPED_BY_HISTORY" });
      continue;
    }

    let applyResult: ApplyResult;
    try {
      applyResult = await options.dependencies.applyOnce(item, () => { result.attempted += 1; });
    } catch (error) {
      try { await options.dependencies.persistFailure(item, error); }
      catch { result.stoppedEarly = true; result.stopReason = "DATABASE_UNAVAILABLE"; break; }
      result.failed += 1;
      result.results.push({ jobId: item.job.jobId, title: item.job.title, company: item.job.company, status: "FAILED" });
      continue;
    }
    try { await options.dependencies.persistApplyResult(item, applyResult); }
    catch { result.stoppedEarly = true; result.stopReason = "DATABASE_UNAVAILABLE"; break; }

    if (externalReclassification(applyResult)) {
      result.results.push({ jobId: item.job.jobId, title: item.job.title, company: item.job.company, status: "EXTERNAL_RECLASSIFIED" });
      continue;
    }
    if (applyResult.status === "APPLIED") result.applied += 1;
    if (applyResult.status === "ALREADY_APPLIED") result.alreadyApplied += 1;
    result.results.push({ jobId: item.job.jobId, title: item.job.title, company: item.job.company, status: applyResult.status });

    if (applyResult.status === "QUESTIONNAIRE") {
      let questionnaire: { status: string };
      try {
        questionnaire = await options.dependencies.runQuestionnaire(item);
        await options.dependencies.persistQuestionnaireResult(item, questionnaire);
      } catch (error) {
        try { await options.dependencies.persistFailure(item, error); }
        catch { result.stopReason = "DATABASE_UNAVAILABLE"; }
        result.failed += 1;
        result.results[result.results.length - 1]!.status = "FAILED";
        result.stoppedEarly = true;
        result.stopReason ??= "QUESTIONNAIRE_FAILED";
        break;
      }
      const last = result.results[result.results.length - 1]!;
      last.status = questionnaire.status === "APPLIED" ? "APPLIED"
        : questionnaire.status === "NEEDS_INPUT" || questionnaire.status === "READY_FOR_REVIEW" ? "NEEDS_INPUT"
        : questionnaire.status === "VALIDATION_FAILED" ? "FAILED"
        : questionnaire.status === "DRY_RUN" ? "QUESTIONNAIRE"
        : questionnaire.status as BatchJobStatus;
      if (last.status === "APPLIED") result.applied += 1;
      else if (last.status === "NEEDS_INPUT") result.needsInput += 1;
      else if (last.status === "FAILED") result.failed += 1;
      else if (last.status === "AUTH_REQUIRED") {
        result.stoppedEarly = true; result.stopReason = "AUTH_REQUIRED"; break;
      } else if (last.status === "UNKNOWN") {
        result.stoppedEarly = true; result.stopReason = "UNKNOWN_UNSAFE_STATE"; break;
      }
      continue;
    }
    if (applyResult.status === "AUTH_REQUIRED") {
      result.stoppedEarly = true; result.stopReason = "AUTH_REQUIRED"; break;
    }
    if (applyResult.status === "UNKNOWN") {
      result.stoppedEarly = true; result.stopReason = "UNKNOWN_UNSAFE_STATE"; break;
    }
  }
  return result;
}
