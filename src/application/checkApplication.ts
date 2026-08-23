import type { DetailedJob } from "../naukri/getJobDetails.js";
import { applyWithAdapter, type ApplyAdapter, type PostApplySignals } from "../naukri/applyToJob.js";
import type { MatchResult } from "../matching/match.schema.js";
import { isEligibleForApplication, isDryRun, selectReadyToApplyJobs } from "./application.js";
import { runApplicationGate } from "./approval.js";

function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
function job(applicationType: DetailedJob["applicationType"] = "NAUKRI_DIRECT"): DetailedJob {
  return { title: "Frontend Developer", company: "Company", location: "Pune", jobUrl: "https://www.naukri.com/job-123",
    jobId: "123", description: "Description", applicationType };
}
function match(score: number, recommendation: MatchResult["recommendation"] = "APPLY"): MatchResult {
  return { jobId: "123", title: "Frontend Developer", company: "Company", jobUrl: "https://www.naukri.com/job-123",
    overallScore: score, skillMatchScore: score, experienceMatchScore: score, roleMatchScore: score,
    responsibilityMatchScore: score, skillMatches: [], unknownSkills: [], hardMissingRequirements: [], matchedSkills: [],
    missingRequiredSkills: [], missingPreferredSkills: [], matchedEvidence: [], strengths: [], concerns: [], recommendation, reason: "test" };
}

expect(isEligibleForApplication(job(), match(90)), "Direct APPLY must be eligible");
expect(!isEligibleForApplication(job("EXTERNAL_COMPANY"), match(90)), "External APPLY must not be eligible");
expect(!isEligibleForApplication(job(), match(75, "REVIEW")), "REVIEW must not be eligible");
expect(!isEligibleForApplication(job(), match(60, "SKIP")), "SKIP must not be eligible");
const jobs = [job(), { ...job(), jobId: "456", jobUrl: "https://www.naukri.com/job-456" }, { ...job(), jobId: "789", jobUrl: "https://www.naukri.com/job-789" }];
const matches = [match(88), { ...match(94), jobId: "456", jobUrl: "https://www.naukri.com/job-456" }, { ...match(91), jobId: "789", jobUrl: "https://www.naukri.com/job-789" }];
expect(selectReadyToApplyJobs(jobs, matches)[0]?.match.overallScore === 94, "Highest eligible selection failed");
expect(isDryRun({}) && !isDryRun({ APPLY_DRY_RUN: "false" }), "Dry-run default failed");

let liveCalls = 0; let verifyCalls = 0;
await runApplicationGate({ dryRun: true, verifyDryRun: async () => { verifyCalls += 1; return { status: "DRY_RUN" }; },
  applyLive: async () => { liveCalls += 1; return { status: "APPLIED" }; } });
expect(verifyCalls === 1 && liveCalls === 0, "Dry run invoked live apply");
await runApplicationGate({ dryRun: false, approval: "no", verifyDryRun: async () => ({ status: "DRY_RUN" }),
  applyLive: async () => { liveCalls += 1; return { status: "APPLIED" }; } });
expect(liveCalls === 0, "Human rejection invoked live apply");

function adapter(options: { type?: Awaited<ReturnType<ApplyAdapter["detectType"]>>["applicationType"]; signals?: PostApplySignals; authenticated?: boolean } = {}) {
  let clicks = 0;
  const value: ApplyAdapter = { open: async () => undefined, isAuthenticated: async () => options.authenticated ?? true,
    verifyIdentity: async () => true, detectType: async () => ({ applicationType: options.type ?? "NAUKRI_DIRECT" }),
    hasDirectApplyControl: async () => true, clickDirectApplyOnce: async () => { clicks += 1; },
    inspectResult: async () => options.signals ?? {} };
  return { value, clicks: () => clicks };
}

const external = adapter({ type: "EXTERNAL_COMPANY" });
expect((await applyWithAdapter(external.value, job(), false)).status === "UNKNOWN" && external.clicks() === 0, "External reclassification clicked");
const adapterDryRun = adapter();
expect((await applyWithAdapter(adapterDryRun.value, job(), true)).status === "DRY_RUN" && adapterDryRun.clicks() === 0, "Browser dry run clicked Apply");
const questionnaire = adapter({ signals: { questionnaire: true, visibleQuestions: 3 } });
expect((await applyWithAdapter(questionnaire.value, job(), false)).status === "QUESTIONNAIRE" && questionnaire.clicks() === 1, "Questionnaire detection failed");
const applied = adapter({ signals: { applied: true } });
expect((await applyWithAdapter(applied.value, job(), false)).status === "APPLIED" && applied.clicks() === 1, "Successful apply detection failed");
const already = adapter({ signals: { alreadyApplied: true } });
expect((await applyWithAdapter(already.value, job(), false)).status === "ALREADY_APPLIED" && already.clicks() === 1, "Already-applied detection failed");
const unknown = adapter();
expect((await applyWithAdapter(unknown.value, job(), false)).status === "UNKNOWN" && unknown.clicks() === 1, "Unknown result handling failed");
const auth = adapter({ authenticated: false });
expect((await applyWithAdapter(auth.value, job(), false)).status === "AUTH_REQUIRED" && auth.clicks() === 0, "Auth-required handling failed");

console.log("Eligibility tests: PASSED");
console.log("Highest-ranked selection: PASSED");
console.log("Dry-run gate: PASSED");
console.log("Human-rejection gate: PASSED");
console.log("External reclassification: PASSED");
console.log("Questionnaire detection/no interaction: PASSED");
console.log("Applied/already/auth/unknown detection: PASSED");
