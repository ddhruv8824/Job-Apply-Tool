import type { MatchResult } from "../matching/match.schema.js";
import type { DetailedJob } from "../naukri/getJobDetails.js";
import type { ApplyResult, ReadyToApplyJob } from "./application.js";
import { getBatchMaxApplications, HARD_BATCH_MAX_APPLICATIONS, isBatchDryRun, runControlledBatch, selectEligibleApplications, type BatchDependencies } from "./batch.js";

function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
function detailed(id: number): DetailedJob { return { jobId: String(id), title: `Job ${id}`, company: `Company ${id}`, location: "Pune", jobUrl: `https://www.naukri.com/job-${id}`, description: "Description", applicationType: "NAUKRI_DIRECT" }; }
function match(id: number, score: number): MatchResult { return { jobId: String(id), title: `Job ${id}`, company: `Company ${id}`, jobUrl: `https://www.naukri.com/job-${id}`, overallScore: score, skillMatchScore: score, experienceMatchScore: score, roleMatchScore: score, responsibilityMatchScore: score, skillMatches: [], unknownSkills: [], hardMissingRequirements: [], matchedSkills: [], missingRequiredSkills: [], missingPreferredSkills: [], matchedEvidence: [], strengths: [], concerns: [], recommendation: score >= 85 ? "APPLY" : score >= 70 ? "REVIEW" : "SKIP", reason: "test" }; }
function ready(id: number, score = 90): ReadyToApplyJob { return { job: detailed(id), match: match(id, score) }; }

const ordered = selectEligibleApplications([detailed(1), detailed(2), detailed(3), detailed(4)], [match(1, 89), match(2, 96), match(3, 91), match(4, 87)], 3);
expect(ordered.map((item) => item.match.overallScore).join(",") === "96,91,89", "Queue ordering or limit failed");
expect(getBatchMaxApplications({}) === 3, "Default batch maximum failed");
expect(getBatchMaxApplications({ BATCH_MAX_APPLICATIONS: "100" }) === HARD_BATCH_MAX_APPLICATIONS, "Hard maximum was not enforced");
expect(selectEligibleApplications(Array.from({ length: 10 }, (_, index) => detailed(index + 1)), Array.from({ length: 10 }, (_, index) => match(index + 1, 95 - index)), 100).length === 5, "Hard maximum allowed more than five queue entries");
expect(isBatchDryRun({}) && !isBatchDryRun({ BATCH_DRY_RUN: "false" }), "Batch dry-run default failed");

type Harness = { clicks: number; persisted: string[]; questionnairePersisted: string[]; processed: number[] };
function deps(harness: Harness, options: {
  healthy?: () => boolean;
  blockedIds?: Set<string>;
  apply?: (item: ReadyToApplyJob, onAttempt: () => void) => Promise<ApplyResult>;
  questionnaire?: () => Promise<{ status: string }>;
} = {}): BatchDependencies {
  return {
    databaseHealthy: async () => options.healthy?.() ?? true,
    getDatabaseStatus: async () => "READY_TO_APPLY",
    hasAlreadyApplied: async (item) => options.blockedIds?.has(item.job.jobId ?? "") ?? false,
    applyOnce: async (item, onAttempt) => {
      harness.processed.push(Number(item.job.jobId));
      if (options.apply) return options.apply(item, onAttempt);
      onAttempt(); harness.clicks += 1; return { status: "APPLIED" };
    },
    persistApplyResult: async (_item, result) => { harness.persisted.push(result.status); },
    runQuestionnaire: options.questionnaire ?? (async () => ({ status: "NEEDS_INPUT" })),
    persistQuestionnaireResult: async (_item, result) => { harness.questionnairePersisted.push(result.status); },
    persistFailure: async () => { harness.persisted.push("FAILED"); },
  };
}
function harness(): Harness { return { clicks: 0, persisted: [], questionnairePersisted: [], processed: [] }; }
const yesPrompts = { approveBatch: async () => "yes", approveJob: async () => "yes" };

const unavailableHarness = harness();
const unavailable = await runControlledBatch({ jobs: [ready(1)], dryRun: false, prompts: yesPrompts, dependencies: deps(unavailableHarness, { healthy: () => false }) });
expect(unavailable.stopReason === "DATABASE_UNAVAILABLE" && unavailableHarness.clicks === 0, "Unavailable DB did not block live batch");

const dryHarness = harness();
const dry = await runControlledBatch({ jobs: [ready(1), ready(2)], dryRun: true, prompts: yesPrompts, dependencies: deps(dryHarness) });
expect(dry.attempted === 0 && dryHarness.clicks === 0, "Batch dry run allowed a click");

const cancelHarness = harness();
const cancelled = await runControlledBatch({ jobs: [ready(1)], dryRun: false, prompts: { ...yesPrompts, approveBatch: async () => "no" }, dependencies: deps(cancelHarness) });
expect(cancelled.stopReason === "BATCH_CANCELLED" && cancelHarness.clicks === 0, "Batch cancellation failed");

const skipHarness = harness(); let jobPrompt = 0;
const skipped = await runControlledBatch({ jobs: [ready(1), ready(2)], dryRun: false, prompts: { approveBatch: async () => "y", approveJob: async () => ++jobPrompt === 1 ? "skip" : "yes" }, dependencies: deps(skipHarness) });
expect(skipped.skippedByUser === 1 && skipped.attempted === 1 && skipHarness.processed.join(",") === "2", "Per-job skip failed");

const stopHarness = harness(); jobPrompt = 0;
const stopped = await runControlledBatch({ jobs: [ready(1), ready(2), ready(3)], dryRun: false, prompts: { approveBatch: async () => "yes", approveJob: async () => ++jobPrompt === 1 ? "yes" : "stop" }, dependencies: deps(stopHarness) });
expect(stopped.stopReason === "STOPPED_BY_USER" && stopHarness.processed.join(",") === "1", "User stop did not prevent later jobs");

const historyHarness = harness();
const history = await runControlledBatch({ jobs: [ready(1)], dryRun: false, prompts: yesPrompts, dependencies: deps(historyHarness, { blockedIds: new Set(["1"]) }) });
expect(history.skippedByHistory === 1 && historyHarness.clicks === 0, "Last-moment APPLIED history recheck failed");

const authHarness = harness();
const auth = await runControlledBatch({ jobs: [ready(1), ready(2), ready(3)], dryRun: false, prompts: yesPrompts, dependencies: deps(authHarness, { apply: async (item, onAttempt) => { onAttempt(); authHarness.clicks += 1; return { status: item.job.jobId === "2" ? "AUTH_REQUIRED" : "APPLIED" }; } }) });
expect(auth.stopReason === "AUTH_REQUIRED" && authHarness.processed.join(",") === "1,2" && authHarness.persisted.join(",") === "APPLIED,AUTH_REQUIRED", "AUTH_REQUIRED stop/persistence failed");

const immediateHarness = harness(); let firstPersistedBeforeSecond = false;
const immediateDependencies = deps(immediateHarness, { apply: async (item, onAttempt) => { if (item.job.jobId === "2") firstPersistedBeforeSecond = immediateHarness.persisted[0] === "APPLIED"; onAttempt(); immediateHarness.clicks += 1; return { status: "APPLIED" }; } });
await runControlledBatch({ jobs: [ready(1), ready(2)], dryRun: false, prompts: yesPrompts, dependencies: immediateDependencies });
expect(firstPersistedBeforeSecond, "Job result was not persisted before the next job started");

const externalHarness = harness();
const external = await runControlledBatch({ jobs: [ready(1), ready(2)], dryRun: false, prompts: yesPrompts, dependencies: deps(externalHarness, { apply: async (item, onAttempt) => item.job.jobId === "1" ? { status: "UNKNOWN", message: "Application type changed to EXTERNAL_COMPANY; no click performed." } : (onAttempt(), externalHarness.clicks += 1, { status: "APPLIED" }) }) });
expect(!external.stoppedEarly && external.attempted === 1 && externalHarness.processed.length === 2, "External reclassification was not safely skipped");

const unknownHarness = harness();
const unknown = await runControlledBatch({ jobs: [ready(1), ready(2)], dryRun: false, prompts: yesPrompts, dependencies: deps(unknownHarness, { apply: async (_item, onAttempt) => { onAttempt(); unknownHarness.clicks += 1; return { status: "UNKNOWN" }; } }) });
expect(unknown.stopReason === "UNKNOWN_UNSAFE_STATE" && unknownHarness.processed.length === 1 && unknownHarness.persisted[0] === "UNKNOWN", "UNKNOWN did not persist and stop");

const questionnaireHarness = harness();
const questionnaire = await runControlledBatch({ jobs: [ready(1), ready(2)], dryRun: false, prompts: yesPrompts, dependencies: deps(questionnaireHarness, { apply: async (_item, onAttempt) => { onAttempt(); questionnaireHarness.clicks += 1; return { status: "QUESTIONNAIRE" }; }, questionnaire: async () => ({ status: "NEEDS_INPUT" }) }) });
expect(questionnaire.needsInput === 2 && questionnaireHarness.questionnairePersisted.join(",") === "NEEDS_INPUT,NEEDS_INPUT", "Questionnaire NEEDS_INPUT integration failed");

const limitHarness = harness();
await runControlledBatch({ jobs: Array.from({ length: 10 }, (_, index) => ready(index + 1)).slice(0, getBatchMaxApplications({ BATCH_MAX_APPLICATIONS: "3" })), dryRun: false, prompts: yesPrompts, dependencies: deps(limitHarness) });
expect(limitHarness.clicks === 3, "Configured maximum allowed more than three clicks");

console.log("Queue order and configured limit: PASSED");
console.log("Default 3 / hard maximum 5: PASSED");
console.log("DB-required and dry-run zero-click gates: PASSED");
console.log("Batch cancel, per-job skip, and stop: PASSED");
console.log("Last-moment duplicate recheck: PASSED");
console.log("AUTH_REQUIRED and UNKNOWN stop policies: PASSED");
console.log("External reclassification safe skip: PASSED");
console.log("Questionnaire NEEDS_INPUT continuation: PASSED");
console.log("Maximum interaction count: PASSED");
