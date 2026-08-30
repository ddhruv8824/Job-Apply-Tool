import type { JobAgentSummary } from "../agent/state.js";
import type { DatabaseClient } from "./prisma.js";
import { prisma } from "./prisma.js";
import { sanitizeOperationalError } from "./sanitize.js";
import { partitionDailyRuns } from "./runOverlap.js";

export async function createAgentRun(keyword?: string, location?: string, db: DatabaseClient = prisma, runType: "INTERACTIVE" | "DAILY_DISCOVERY" | "UNATTENDED_AUTO_APPLY" = "INTERACTIVE") {
  return db.agentRun.create({ data: { status: "RUNNING", runType, keyword, location } });
}

export async function prepareAutoApplyRun(staleMinutes: number, db: DatabaseClient = prisma): Promise<{ activeRunId?: string; staleRecovered: number }> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  const running = await db.agentRun.findMany({ where: { runType: "UNATTENDED_AUTO_APPLY", status: "RUNNING" }, select: { id: true, startedAt: true } });
  const { staleIds, activeRunId } = partitionDailyRuns(running, cutoff);
  if (staleIds.length) await db.agentRun.updateMany({ where: { id: { in: staleIds }, status: "RUNNING" }, data: {
    status: "FAILED", completedAt: new Date(), error: "STALE_AUTO_APPLY_RUN_RECOVERED",
  } });
  return { activeRunId, staleRecovered: staleIds.length };
}

export type AutoApplyRunCounters = {
  candidateJobs: number; attemptedJobs: number; appliedJobs: number; alreadyAppliedJobs: number;
  questionnaireJobs: number; needsInputJobs: number; skippedJobs: number; failedJobs: number;
};

function autoApplyCounters(counters: AutoApplyRunCounters) {
  return { readyToApplyJobs: counters.candidateJobs, attemptedJobs: counters.attemptedJobs,
    appliedJobs: counters.appliedJobs, alreadyAppliedJobs: counters.alreadyAppliedJobs,
    questionnaireJobs: counters.questionnaireJobs, needsInputJobs: counters.needsInputJobs,
    skippedJobs: counters.skippedJobs, failedJobs: counters.failedJobs };
}

export async function completeAutoApplyRun(id: string, counters: AutoApplyRunCounters, db: DatabaseClient = prisma) {
  return db.agentRun.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date(), ...autoApplyCounters(counters) } });
}

export async function failAutoApplyRun(id: string, error: unknown, counters: AutoApplyRunCounters, db: DatabaseClient = prisma) {
  return db.agentRun.update({ where: { id }, data: { status: "FAILED", completedAt: new Date(), error: sanitizeOperationalError(error), ...autoApplyCounters(counters) } });
}

export async function prepareDailyRun(staleMinutes: number, db: DatabaseClient = prisma): Promise<{ activeRunId?: string; staleRecovered: number }> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  const running = await db.agentRun.findMany({ where: { runType: "DAILY_DISCOVERY", status: "RUNNING" }, select: { id: true, startedAt: true } });
  const { staleIds, activeRunId } = partitionDailyRuns(running, cutoff);
  if (staleIds.length) {
    await db.agentRun.updateMany({ where: { id: { in: staleIds }, status: "RUNNING" }, data: {
      status: "FAILED", completedAt: new Date(), error: "STALE_DAILY_RUN_RECOVERED",
    } });
  }
  return { activeRunId, staleRecovered: staleIds.length };
}

export async function completeDailyAgentRun(id: string, summary: JobAgentSummary, readyCount: number, db: DatabaseClient = prisma) {
  return db.agentRun.update({ where: { id }, data: {
    status: "COMPLETED", completedAt: new Date(), jobsInspected: summary.totalJobs,
    directJobs: summary.directJobs, externalJobs: summary.externalJobs,
    previouslyAppliedSkipped: summary.previouslyAppliedSkipped,
    matchedJobs: summary.analyzedJobs, readyToApplyJobs: readyCount, appliedJobs: 0,
  } });
}

export async function getRecentAgentRuns(limit = 10, db: DatabaseClient = prisma) {
  return db.agentRun.findMany({ take: limit, orderBy: { startedAt: "desc" } });
}

export async function completeAgentRun(id: string, summary: JobAgentSummary, db: DatabaseClient = prisma) {
  return db.agentRun.update({ where: { id }, data: {
    status: "COMPLETED", completedAt: new Date(), jobsInspected: summary.totalJobs,
    directJobs: summary.directJobs, externalJobs: summary.externalJobs,
    previouslyAppliedSkipped: summary.previouslyAppliedSkipped,
    matchedJobs: summary.analyzedJobs, readyToApplyJobs: summary.apply, appliedJobs: 0,
  } });
}

export async function failAgentRun(id: string, error: unknown, db: DatabaseClient = prisma) {
  return db.agentRun.update({ where: { id }, data: { status: "FAILED", completedAt: new Date(), error: sanitizeOperationalError(error) } });
}
