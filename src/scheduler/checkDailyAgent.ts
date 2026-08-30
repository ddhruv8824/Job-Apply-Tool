import type { ReadyToApplyJob } from "../application/application.js";
import { initialJobAgentState } from "../agent/graph.js";
import type { JobAgentState, JobAgentSummary } from "../agent/state.js";
import type { DailyDependencies } from "./daily.js";
import { getDailyMaxReadyJobs, getDailyStaleMinutes, runDailyExecution, selectDailyReadyJobs } from "./daily.js";
import { partitionDailyRuns } from "../db/runOverlap.js";

function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
function ready(id: number, score: number): ReadyToApplyJob {
  return {
    job: { jobId: String(id), title: `Job ${id}`, company: `Company ${id}`, location: "Pune", jobUrl: `https://www.naukri.com/job-${id}`, description: "Description", applicationType: "NAUKRI_DIRECT" },
    match: { jobId: String(id), title: `Job ${id}`, company: `Company ${id}`, jobUrl: `https://www.naukri.com/job-${id}`, overallScore: score, skillMatchScore: score, experienceMatchScore: score, roleMatchScore: score, responsibilityMatchScore: score, skillMatches: [], unknownSkills: [], hardMissingRequirements: [], matchedSkills: [], missingRequiredSkills: [], missingPreferredSkills: [], matchedEvidence: [], strengths: [], concerns: [], recommendation: "APPLY", reason: "test" },
  };
}
const emptySummary: JobAgentSummary = { totalJobs: 0, directJobs: 0, externalJobs: 0, walkInJobs: 0, unknownJobs: 0, analyzedJobs: 0, apply: 0, review: 0, skip: 0, previouslyAppliedSkipped: 0 };
function graph(readyJobs: ReadyToApplyJob[] = [], summary: JobAgentSummary = emptySummary): JobAgentState {
  return { ...initialJobAgentState(), readyToApplyJobs: readyJobs, rankedMatches: readyJobs.map((item) => item.match), detailedJobs: readyJobs.map((item) => item.job), summary };
}
type Calls = { browser: number; auth: number; pipeline: number; created: number; completed: number; failed: string[] };
function calls(): Calls { return { browser: 0, auth: 0, pipeline: 0, created: 0, completed: 0, failed: [] }; }
function dependencies(state: Calls, options: { db?: boolean; active?: boolean; staleRecovered?: number; cdp?: boolean; auth?: boolean; graph?: JobAgentState; pipelineError?: string } = {}): DailyDependencies {
  return {
    databaseHealthy: async () => options.db ?? true,
    prepareDailyRun: async () => ({ activeRunId: options.active ? "active" : undefined, staleRecovered: options.staleRecovered ?? 0 }),
    createRun: async () => { state.created += 1; return { id: "run-1" }; },
    connectChrome: async () => { state.browser += 1; if (options.cdp === false) throw new Error("connection refused"); },
    authenticationReady: async () => { state.auth += 1; return options.auth ?? true; },
    runPipeline: async () => { state.pipeline += 1; if (options.pipelineError) throw new Error(options.pipelineError); return options.graph ?? graph(); },
    completeRun: async () => { state.completed += 1; },
    failRun: async (_id, reason) => { state.failed.push(reason); },
  };
}

expect(getDailyMaxReadyJobs({}) === 10, "Default daily ready limit failed");
expect(getDailyStaleMinutes({}) === 180, "Default stale threshold failed");
const overlapPartition = partitionDailyRuns([
  { id: "stale", startedAt: new Date("2026-08-28T01:00:00Z") },
  { id: "active", startedAt: new Date("2026-08-28T05:00:00Z") },
], new Date("2026-08-28T04:00:00Z"));
expect(overlapPartition.staleIds.join(",") === "stale" && overlapPartition.activeRunId === "active", "Stale/active run classification failed");
const ordered = selectDailyReadyJobs([ready(1, 88), ready(2, 96), ready(3, 91), ready(4, 90)], 3);
expect(ordered.map((item) => item.match.overallScore).join(",") === "96,91,90", "Daily queue ordering/limit failed");

const dbCalls = calls();
const dbFailure = await runDailyExecution({ maxReadyJobs: 10, staleMinutes: 180, dependencies: dependencies(dbCalls, { db: false }) });
expect(dbFailure.reason === "DATABASE_UNAVAILABLE" && dbCalls.browser === 0 && dbCalls.pipeline === 0 && dbCalls.created === 0, "DB preflight allowed browser, AI, or run creation");

const cdpCalls = calls();
const cdpFailure = await runDailyExecution({ maxReadyJobs: 10, staleMinutes: 180, dependencies: dependencies(cdpCalls, { cdp: false }) });
expect(cdpFailure.reason === "CDP_UNAVAILABLE" && cdpCalls.pipeline === 0 && cdpCalls.failed[0] === "CDP_UNAVAILABLE", "CDP failure lifecycle failed");

const authCalls = calls();
const authFailure = await runDailyExecution({ maxReadyJobs: 10, staleMinutes: 180, dependencies: dependencies(authCalls, { auth: false }) });
expect(authFailure.reason === "AUTH_REQUIRED" && authCalls.pipeline === 0 && authCalls.failed[0] === "AUTH_REQUIRED", "Authentication preflight failed");

const zeroCalls = calls();
const zero = await runDailyExecution({ maxReadyJobs: 10, staleMinutes: 180, dependencies: dependencies(zeroCalls, { graph: graph() }) });
expect(zero.status === "COMPLETED" && zero.readyJobs.length === 0 && zeroCalls.completed === 1, "Zero-direct successful completion failed");

const reviewSummary = { ...emptySummary, totalJobs: 2, directJobs: 2, analyzedJobs: 2, review: 1, skip: 1 };
const reviewCalls = calls();
const noApply = await runDailyExecution({ maxReadyJobs: 10, staleMinutes: 180, dependencies: dependencies(reviewCalls, { graph: graph([], reviewSummary) }) });
expect(noApply.status === "COMPLETED" && noApply.readyJobs.length === 0, "Zero-APPLY run was not successful");

let applicationSideEffects = 0;
const readyCalls = calls();
const fifteen = Array.from({ length: 15 }, (_, index) => ready(index + 1, 100 - index));
const readyRun = await runDailyExecution({ maxReadyJobs: 10, staleMinutes: 180, dependencies: dependencies(readyCalls, { graph: graph(fifteen, { ...emptySummary, totalJobs: 15, directJobs: 15, analyzedJobs: 15, apply: 15 }) }) });
expect(readyRun.readyJobs.length === 10 && readyRun.readyJobs[0]?.match.overallScore === 100, "Daily ready queue limit failed");
expect(applicationSideEffects === 0, "Scheduled discovery reached an application side effect");

const overlapCalls = calls();
const overlap = await runDailyExecution({ maxReadyJobs: 10, staleMinutes: 180, dependencies: dependencies(overlapCalls, { active: true }) });
expect(overlap.status === "REFUSED" && overlapCalls.browser === 0 && overlapCalls.created === 0, "Recent overlap was not refused before activity");

const staleCalls = calls();
const stale = await runDailyExecution({ maxReadyJobs: 10, staleMinutes: 180, dependencies: dependencies(staleCalls, { staleRecovered: 1 }) });
expect(stale.status === "COMPLETED" && stale.staleRecovered === 1 && staleCalls.created === 1, "Stale-run recovery did not allow a new run");

const failureCalls = calls();
const failed = await runDailyExecution({ maxReadyJobs: 10, staleMinutes: 180, dependencies: dependencies(failureCalls, { pipelineError: "safe model failure" }) });
expect(failed.status === "FAILED" && failureCalls.failed[0] === "safe model failure" && failureCalls.completed === 0, "Critical failure lifecycle failed");

console.log("Database/CDP/auth preflights: PASSED");
console.log("Zero-direct and zero-APPLY completion: PASSED");
console.log("Ranked daily queue and limit: PASSED");
console.log("Scheduled-mode no-Apply boundary: PASSED");
console.log("Recent overlap refusal: PASSED");
console.log("Stale-run recovery: PASSED");
console.log("Completed/failed lifecycle: PASSED");
