import type { ReadyToApplyJob } from "../application/application.js";
import type { JobAgentState, JobAgentSummary } from "../agent/state.js";

export type AgentExecutionMode = "INTERACTIVE" | "SCHEDULED_DISCOVERY";
export const DAILY_EXECUTION_MODE: AgentExecutionMode = "SCHEDULED_DISCOVERY";
export const DEFAULT_DAILY_MAX_READY_JOBS = 10;
export const DEFAULT_DAILY_RUN_STALE_MINUTES = 180;

export type DailyExecutionResult = {
  status: "COMPLETED" | "FAILED" | "REFUSED";
  runId?: string;
  reason?: string;
  staleRecovered: number;
  graphResult?: JobAgentState;
  readyJobs: ReadyToApplyJob[];
};

export type DailyDependencies = {
  databaseHealthy: () => Promise<boolean>;
  prepareDailyRun: (staleMinutes: number) => Promise<{ activeRunId?: string; staleRecovered: number }>;
  createRun: () => Promise<{ id: string }>;
  connectChrome: () => Promise<void>;
  authenticationReady: () => Promise<boolean>;
  runPipeline: () => Promise<JobAgentState>;
  completeRun: (id: string, summary: JobAgentSummary, readyCount: number) => Promise<void>;
  failRun: (id: string, reason: string) => Promise<void>;
};

function positiveInteger(name: string, raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

export function getDailyMaxReadyJobs(environment: NodeJS.ProcessEnv = process.env): number {
  return positiveInteger("DAILY_MAX_READY_JOBS", environment.DAILY_MAX_READY_JOBS, DEFAULT_DAILY_MAX_READY_JOBS);
}

export function getDailyStaleMinutes(environment: NodeJS.ProcessEnv = process.env): number {
  return positiveInteger("DAILY_RUN_STALE_MINUTES", environment.DAILY_RUN_STALE_MINUTES, DEFAULT_DAILY_RUN_STALE_MINUTES);
}

export function selectDailyReadyJobs(readyJobs: ReadyToApplyJob[], limit: number): ReadyToApplyJob[] {
  return [...readyJobs].sort((left, right) => right.match.overallScore - left.match.overallScore).slice(0, Math.max(0, Math.trunc(limit)));
}

export async function runDailyExecution(options: {
  maxReadyJobs: number;
  staleMinutes: number;
  dependencies: DailyDependencies;
}): Promise<DailyExecutionResult> {
  if (!(await options.dependencies.databaseHealthy())) {
    return { status: "FAILED", reason: "DATABASE_UNAVAILABLE", staleRecovered: 0, readyJobs: [] };
  }
  const overlap = await options.dependencies.prepareDailyRun(options.staleMinutes);
  if (overlap.activeRunId) {
    return { status: "REFUSED", reason: "DAILY_RUN_ALREADY_ACTIVE", staleRecovered: overlap.staleRecovered, readyJobs: [] };
  }

  const run = await options.dependencies.createRun();
  try {
    try { await options.dependencies.connectChrome(); }
    catch { throw new Error("CDP_UNAVAILABLE"); }
    if (!(await options.dependencies.authenticationReady())) throw new Error("AUTH_REQUIRED");

    const graphResult = await options.dependencies.runPipeline();
    if (!graphResult.summary) throw new Error("DAILY_GRAPH_SUMMARY_MISSING");
    const readyJobs = selectDailyReadyJobs(graphResult.readyToApplyJobs, options.maxReadyJobs);
    await options.dependencies.completeRun(run.id, graphResult.summary, readyJobs.length);
    return { status: "COMPLETED", runId: run.id, staleRecovered: overlap.staleRecovered, graphResult, readyJobs };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await options.dependencies.failRun(run.id, reason);
    return { status: "FAILED", runId: run.id, reason, staleRecovered: overlap.staleRecovered, readyJobs: [] };
  }
}
