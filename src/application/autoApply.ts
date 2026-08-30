import type { ApplyResult, ReadyToApplyJob } from "./application.js";
import type { AutoApplyPolicy } from "./autoApplyPolicy.js";
import { evaluateAutoApplyEligibility, rankAutoApplyCandidates } from "./autoApplyPolicy.js";

export type AutoApplyCounters = {
  candidateJobs: number; attemptedJobs: number; appliedJobs: number; alreadyAppliedJobs: number;
  questionnaireJobs: number; needsInputJobs: number; skippedJobs: number; failedJobs: number;
};

export type AutoApplyExecutionResult = AutoApplyCounters & {
  status: "COMPLETED" | "FAILED" | "REFUSED" | "DISABLED";
  runId?: string; reason?: string; stoppedEarly: boolean; alreadyAttemptedToday: number;
  remainingBeforeRun: number; remainingDailyAllowance: number; staleRecovered: number;
};

export type AutoApplyDependencies = {
  databaseHealthy: () => Promise<boolean>;
  prepareRun: (staleMinutes: number) => Promise<{ activeRunId?: string; staleRecovered: number }>;
  createRun: () => Promise<{ id: string }>;
  countAttemptsToday: () => Promise<number>;
  connectChrome: () => Promise<void>;
  authenticationReady: () => Promise<boolean>;
  loadCandidates: () => Promise<ReadyToApplyJob[]>;
  getDatabaseStatus: (job: ReadyToApplyJob) => Promise<string | null>;
  applyOnce: (job: ReadyToApplyJob, recordActualClick: () => Promise<void>) => Promise<ApplyResult>;
  recordActualClick: (job: ReadyToApplyJob) => Promise<void>;
  persistResult: (job: ReadyToApplyJob, result: ApplyResult) => Promise<void>;
  persistReclassification: (job: ReadyToApplyJob) => Promise<void>;
  persistFailure: (job: ReadyToApplyJob, error: unknown) => Promise<void>;
  completeRun: (id: string, counters: AutoApplyCounters) => Promise<void>;
  failRun: (id: string, reason: string, counters: AutoApplyCounters) => Promise<void>;
};

function counters(): AutoApplyCounters {
  return { candidateJobs: 0, attemptedJobs: 0, appliedJobs: 0, alreadyAppliedJobs: 0,
    questionnaireJobs: 0, needsInputJobs: 0, skippedJobs: 0, failedJobs: 0 };
}

export async function runUnattendedAutoApply(options: {
  policy: AutoApplyPolicy; staleMinutes: number; dependencies: AutoApplyDependencies;
}): Promise<AutoApplyExecutionResult> {
  const count = counters();
  const base = { ...count, stoppedEarly: false, alreadyAttemptedToday: 0, remainingBeforeRun: 0, remainingDailyAllowance: 0, staleRecovered: 0 };
  if (!options.policy.enabled) return { ...base, status: "DISABLED", reason: "AUTO_APPLY_DISABLED" };
  if (!(await options.dependencies.databaseHealthy())) return { ...base, status: "FAILED", reason: "DATABASE_UNAVAILABLE", stoppedEarly: true };

  const overlap = await options.dependencies.prepareRun(options.staleMinutes);
  if (overlap.activeRunId) return { ...base, status: "REFUSED", reason: "AUTO_APPLY_RUN_ALREADY_ACTIVE", staleRecovered: overlap.staleRecovered };
  const alreadyAttemptedToday = await options.dependencies.countAttemptsToday();
  const remainingBeforeRun = Math.max(0, options.policy.dailyLimit - alreadyAttemptedToday);
  if (remainingBeforeRun === 0) return { ...base, status: "COMPLETED", alreadyAttemptedToday, remainingBeforeRun, staleRecovered: overlap.staleRecovered };

  const run = await options.dependencies.createRun();
  const finish = (status: AutoApplyExecutionResult["status"], reason?: string, stoppedEarly = false): AutoApplyExecutionResult => ({
    ...count, status, runId: run.id, reason, stoppedEarly, alreadyAttemptedToday, remainingBeforeRun,
    remainingDailyAllowance: Math.max(0, remainingBeforeRun - count.attemptedJobs), staleRecovered: overlap.staleRecovered,
  });
  try {
    try { await options.dependencies.connectChrome(); } catch { throw new Error("CDP_UNAVAILABLE"); }
    if (!(await options.dependencies.authenticationReady())) throw new Error("AUTH_REQUIRED");
    const queue = rankAutoApplyCandidates(await options.dependencies.loadCandidates());
    count.candidateJobs = queue.length;
    const maximumAttempts = Math.min(remainingBeforeRun, options.policy.runLimit, queue.length);

    for (const item of queue) {
      if (count.attemptedJobs >= maximumAttempts) break;
      if (!(await options.dependencies.databaseHealthy())) throw new Error("DATABASE_UNAVAILABLE");
      const status = await options.dependencies.getDatabaseStatus(item);
      const eligibility = evaluateAutoApplyEligibility({ candidate: item, databaseStatus: status, policy: options.policy,
        databaseHealthy: true, cdpHealthy: true, authenticated: true,
        dailyAllowance: remainingBeforeRun - count.attemptedJobs, runAllowance: options.policy.runLimit - count.attemptedJobs });
      if (!eligibility.eligible) { count.skippedJobs += 1; continue; }

      let result: ApplyResult;
      let clickRecorded = false;
      try {
        result = await options.dependencies.applyOnce(item, async () => {
          if (clickRecorded) throw new Error("MULTIPLE_APPLY_CLICK_CALLBACKS");
          await options.dependencies.recordActualClick(item);
          clickRecorded = true;
          count.attemptedJobs += 1;
        });
      } catch (error) {
        await options.dependencies.persistFailure(item, error);
        count.failedJobs += 1;
        throw error;
      }

      if (result.interactionOccurred && !clickRecorded) throw new Error("UNRECORDED_LIVE_APPLY_INTERACTION");
      if (result.reason === "LIVE_RECLASSIFIED") {
        await options.dependencies.persistReclassification(item);
        count.skippedJobs += 1;
        continue;
      }
      await options.dependencies.persistResult(item, result);
      if (result.status === "APPLIED") count.appliedJobs += 1;
      else if (result.status === "ALREADY_APPLIED") count.alreadyAppliedJobs += 1;
      else if (result.status === "QUESTIONNAIRE") {
        count.questionnaireJobs += 1;
        if (result.needsInput) count.needsInputJobs += 1;
        continue;
      } else if (result.status === "AUTH_REQUIRED") throw new Error("AUTH_REQUIRED");
      else if (result.status === "UNKNOWN") throw new Error(result.reason ?? "UNKNOWN_UNSAFE_STATE");
    }
    await options.dependencies.completeRun(run.id, count);
    return finish("COMPLETED");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await options.dependencies.failRun(run.id, reason, count).catch(() => undefined);
    return finish("FAILED", reason, true);
  }
}
