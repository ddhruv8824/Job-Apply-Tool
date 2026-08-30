import type { ApplyResult, ReadyToApplyJob } from "./application.js";
import type { MatchResult } from "../matching/match.schema.js";
import type { DetailedJob } from "../naukri/getJobDetails.js";
import { evaluateAutoApplyEligibility, getAutoApplyPolicy, HARD_AUTO_APPLY_LIMIT, rankAutoApplyCandidates } from "./autoApplyPolicy.js";
import { runUnattendedAutoApply, type AutoApplyDependencies } from "./autoApply.js";

function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
function job(id: number, applicationType: DetailedJob["applicationType"] = "NAUKRI_DIRECT"): DetailedJob {
  return { jobId: String(id), title: `Job ${id}`, company: `Company ${id}`, location: "Pune",
    jobUrl: `https://www.naukri.com/job-${id}`, description: "Description", applicationType };
}
function match(id: number, score = 90, recommendation: MatchResult["recommendation"] = "APPLY"): MatchResult {
  return { jobId: String(id), title: `Job ${id}`, company: `Company ${id}`, jobUrl: `https://www.naukri.com/job-${id}`,
    overallScore: score, skillMatchScore: score, experienceMatchScore: score, roleMatchScore: score,
    responsibilityMatchScore: score, skillMatches: [], unknownSkills: [], hardMissingRequirements: [], matchedSkills: [],
    missingRequiredSkills: [], missingPreferredSkills: [], matchedEvidence: [], strengths: [], concerns: [], recommendation, reason: "test" };
}
function ready(id: number, score = 90, applicationType: DetailedJob["applicationType"] = "NAUKRI_DIRECT", recommendation: MatchResult["recommendation"] = "APPLY"): ReadyToApplyJob {
  return { job: job(id, applicationType), match: match(id, score, recommendation) };
}

type Harness = {
  dbChecks: number; cdp: number; auth: number; pipeline: number; clicks: number; questionnaireSubmits: number;
  statuses: Map<string, string>; persisted: string[]; events: string[]; completed: number; failed: string[];
};
function harness(): Harness { return { dbChecks: 0, cdp: 0, auth: 0, pipeline: 0, clicks: 0, questionnaireSubmits: 0,
  statuses: new Map(), persisted: [], events: [], completed: 0, failed: [] }; }
function dependencies(state: Harness, options: {
  healthy?: boolean; cdp?: boolean; auth?: boolean; attemptsToday?: number; candidates?: ReadyToApplyJob[];
  active?: boolean; staleRecovered?: number; statusFor?: (item: ReadyToApplyJob) => string | null;
  apply?: (item: ReadyToApplyJob, record: () => Promise<void>) => Promise<ApplyResult>;
} = {}): AutoApplyDependencies {
  return {
    databaseHealthy: async () => { state.dbChecks += 1; return options.healthy ?? true; },
    prepareRun: async () => ({ activeRunId: options.active ? "active" : undefined, staleRecovered: options.staleRecovered ?? 0 }),
    createRun: async () => ({ id: "run-1" }), countAttemptsToday: async () => options.attemptsToday ?? 0,
    connectChrome: async () => { state.cdp += 1; if (options.cdp === false) throw new Error("unavailable"); },
    authenticationReady: async () => { state.auth += 1; return options.auth ?? true; },
    loadCandidates: async () => { state.pipeline += 1; return options.candidates ?? [ready(1)]; },
    getDatabaseStatus: async (item) => options.statusFor?.(item) ?? state.statuses.get(item.job.jobId ?? "") ?? "READY_TO_APPLY",
    applyOnce: async (item, record) => {
      state.events.push(`begin:${item.job.jobId}`);
      if (options.apply) return options.apply(item, record);
      state.clicks += 1; await record(); return { status: "APPLIED", interactionOccurred: true };
    },
    recordActualClick: async (item) => { state.events.push(`attempt:${item.job.jobId}`); },
    persistResult: async (item, result) => { state.persisted.push(result.needsInput ? "NEEDS_INPUT" : result.status); state.events.push(`persist:${item.job.jobId}`); },
    persistReclassification: async (item) => { state.persisted.push("EXTERNAL_SKIPPED"); state.events.push(`persist:${item.job.jobId}`); },
    persistFailure: async () => { state.persisted.push("FAILED"); },
    completeRun: async () => { state.completed += 1; },
    failRun: async (_id, reason) => { state.failed.push(reason); },
  };
}
const enabledPolicy = getAutoApplyPolicy({ AUTO_APPLY_ENABLED: "true" });

expect(!getAutoApplyPolicy({}).enabled, "Missing AUTO_APPLY_ENABLED was not disabled");
expect(!getAutoApplyPolicy({ AUTO_APPLY_ENABLED: "false" }).enabled, "Explicit false was not disabled");
expect(getAutoApplyPolicy({ AUTO_APPLY_ENABLED: "true", AUTO_APPLY_DAILY_LIMIT: "100", AUTO_APPLY_RUN_LIMIT: "100" }).dailyLimit === HARD_AUTO_APPLY_LIMIT, "Daily hard limit failed");
expect(getAutoApplyPolicy({ AUTO_APPLY_ENABLED: "true", AUTO_APPLY_DAILY_LIMIT: "100", AUTO_APPLY_RUN_LIMIT: "100" }).runLimit === HARD_AUTO_APPLY_LIMIT, "Run hard limit failed");
expect(rankAutoApplyCandidates([ready(1, 87), ready(2, 96), ready(3, 91), ready(4, 90)]).map((item) => item.match.overallScore).join(",") === "96,91,90,87", "Rank ordering failed");

const policyInput = (candidate: ReadyToApplyJob, databaseStatus: string | null = "READY_TO_APPLY") => ({ candidate, databaseStatus, policy: enabledPolicy,
  databaseHealthy: true, cdpHealthy: true, authenticated: true, dailyAllowance: 3, runAllowance: 3 });
expect(!evaluateAutoApplyEligibility(policyInput(ready(1, 82, "NAUKRI_DIRECT", "REVIEW"))).eligible, "REVIEW became eligible");
expect(!evaluateAutoApplyEligibility(policyInput(ready(1, 60, "NAUKRI_DIRECT", "SKIP"))).eligible, "SKIP became eligible");
expect(!evaluateAutoApplyEligibility(policyInput(ready(1, 99, "EXTERNAL_COMPANY"))).eligible, "External became eligible");
expect(!evaluateAutoApplyEligibility(policyInput(ready(1, 99, "UNKNOWN"))).eligible, "Unknown type became eligible");
expect(!evaluateAutoApplyEligibility(policyInput(ready(1, 100), "APPLIED")).eligible, "APPLIED became eligible");
expect(!evaluateAutoApplyEligibility(policyInput(ready(1, 100), "ALREADY_APPLIED")).eligible, "ALREADY_APPLIED became eligible");

let state = harness();
let result = await runUnattendedAutoApply({ policy: getAutoApplyPolicy({}), staleMinutes: 180, dependencies: dependencies(state) });
expect(result.status === "DISABLED" && state.clicks === 0 && state.dbChecks === 0, "Default disabled gate touched DB or Apply");
state = harness(); result = await runUnattendedAutoApply({ policy: getAutoApplyPolicy({ AUTO_APPLY_ENABLED: "false" }), staleMinutes: 180, dependencies: dependencies(state) });
expect(result.status === "DISABLED" && state.clicks === 0, "Explicit false allowed Apply");
state = harness(); result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { healthy: false }) });
expect(result.reason === "DATABASE_UNAVAILABLE" && state.clicks === 0 && state.cdp === 0, "Unavailable DB allowed browser activity");
state = harness(); result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { cdp: false }) });
expect(result.reason === "CDP_UNAVAILABLE" && state.clicks === 0 && state.pipeline === 0, "Unavailable CDP allowed Apply/pipeline");
state = harness(); result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { auth: false }) });
expect(result.reason === "AUTH_REQUIRED" && state.clicks === 0 && state.pipeline === 0, "Auth preflight allowed Apply/pipeline");

state = harness(); result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { attemptsToday: 2, candidates: [ready(1), ready(2), ready(3)] }) });
expect(state.clicks === 1 && result.remainingDailyAllowance === 0, "Daily remaining allowance failed");
state = harness(); result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { attemptsToday: 3, candidates: [ready(1)] }) });
expect(state.clicks === 0 && state.cdp === 0 && result.status === "COMPLETED", "Reached daily limit opened browser or clicked");
state = harness(); result = await runUnattendedAutoApply({ policy: { ...enabledPolicy, dailyLimit: 5, runLimit: 2 }, staleMinutes: 180, dependencies: dependencies(state, { candidates: Array.from({ length: 10 }, (_, i) => ready(i + 1, 99 - i)) }) });
expect(state.clicks === 2 && result.status === "COMPLETED", "Run limit failed");

state = harness(); let statusReads = 0;
result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { candidates: [ready(1)], statusFor: () => (++statusReads, "APPLIED") }) });
expect(statusReads === 1 && state.clicks === 0 && result.skippedJobs === 1, "Pre-click DB recheck failed");
state = harness(); result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { candidates: [ready(1), ready(2)], apply: async (item, record) => item.job.jobId === "1" ? { status: "UNKNOWN", reason: "LIVE_RECLASSIFIED", interactionOccurred: false } : (state.clicks += 1, await record(), { status: "APPLIED", interactionOccurred: true }) }) });
expect(state.clicks === 1 && state.persisted.join(",") === "EXTERNAL_SKIPPED,APPLIED", "Live reclassification did not skip without click");

state = harness(); result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state) });
expect(result.appliedJobs === 1 && result.attemptedJobs === 1 && state.persisted[0] === "APPLIED", "APPLIED persistence/count failed");
state = harness(); result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { candidates: [ready(1), ready(2)], apply: async (_item, record) => { state.clicks += 1; await record(); return { status: "QUESTIONNAIRE", interactionOccurred: true }; } }) });
expect(result.questionnaireJobs === 2 && state.questionnaireSubmits === 0 && state.clicks === 2, "Questionnaire detect-only continuation failed");
state = harness(); result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { apply: async (_item, record) => { state.clicks += 1; await record(); return { status: "QUESTIONNAIRE", interactionOccurred: true, needsInput: true }; } }) });
expect(result.needsInputJobs === 1 && state.persisted[0] === "NEEDS_INPUT" && state.questionnaireSubmits === 0, "NEEDS_INPUT policy failed");
state = harness(); result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { candidates: [ready(1), ready(2)], apply: async (_item, record) => { state.clicks += 1; await record(); return { status: "UNKNOWN", interactionOccurred: true, reason: "UNKNOWN_POST_CLICK" }; } }) });
expect(result.reason === "UNKNOWN_POST_CLICK" && state.clicks === 1 && state.persisted[0] === "UNKNOWN", "UNKNOWN persistence/stop failed");
state = harness(); result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { candidates: [ready(1), ready(2), ready(3)], apply: async (item, record) => { state.clicks += 1; await record(); return item.job.jobId === "2" ? { status: "AUTH_REQUIRED", interactionOccurred: true, reason: "AUTH_REQUIRED" } : { status: "APPLIED", interactionOccurred: true }; } }) });
expect(result.reason === "AUTH_REQUIRED" && state.clicks === 2 && state.persisted.join(",") === "APPLIED,AUTH_REQUIRED", "Auth loss did not stop subsequent jobs");
state = harness(); result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { candidates: [ready(1), ready(2)], apply: async (_item, record) => { state.clicks += 1; await record(); return { status: "UNKNOWN", interactionOccurred: true, reason: "EXTERNAL_REDIRECT" }; } }) });
expect(result.reason === "EXTERNAL_REDIRECT" && state.clicks === 1, "External redirect did not stop");

state = harness(); let persistedBeforeSecond = false;
result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { candidates: [ready(1), ready(2)], apply: async (item, record) => { if (item.job.jobId === "2") persistedBeforeSecond = state.events.includes("persist:1"); state.clicks += 1; await record(); return { status: "APPLIED", interactionOccurred: true }; } }) });
expect(persistedBeforeSecond, "Result was not persisted before next job");
state = harness(); result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { active: true }) });
expect(result.status === "REFUSED" && state.cdp === 0 && state.clicks === 0, "Overlap protection failed");
state = harness(); result = await runUnattendedAutoApply({ policy: enabledPolicy, staleMinutes: 180, dependencies: dependencies(state, { staleRecovered: 1, candidates: [] }) });
expect(result.status === "COMPLETED" && result.staleRecovered === 1, "Stale recovery/no-candidates completion failed");

console.log("Default-off, explicit-false, DB/CDP/auth gates: PASSED");
console.log("Daily/run/hard limits and rank order: PASSED");
console.log("Deterministic direct/APPLY/score/history policy: PASSED");
console.log("Pre-click DB recheck and live reclassification: PASSED");
console.log("APPLIED/questionnaire/NEEDS_INPUT immediate persistence: PASSED");
console.log("UNKNOWN/auth-loss/external-redirect stop policies: PASSED");
console.log("Overlap/stale recovery and no-candidate completion: PASSED");
console.log("Questionnaire submissions and real browser calls: 0");
