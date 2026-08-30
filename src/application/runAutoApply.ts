import { loadEnvFile } from "node:process";
import type { Page } from "playwright";
import { getAutoApplyPolicy, HARD_AUTO_APPLY_LIMIT } from "./autoApplyPolicy.js";
import { runUnattendedAutoApply, type AutoApplyExecutionResult } from "./autoApply.js";
import { getDailyStaleMinutes } from "../scheduler/daily.js";

try { loadEnvFile(); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const policy = getAutoApplyPolicy();
if (!policy.enabled) {
  console.log("Unattended auto-apply is disabled.");
  console.log("Set AUTO_APPLY_ENABLED=true only after completing live integration validation.");
  console.log("Apply clicks: 0");
  process.exit(0);
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error("Unattended auto-apply aborted.\nDatabase unavailable.\nDuplicate protection and daily limits cannot be guaranteed.\nApply clicks: 0");
  process.exit(1);
}

const { prisma } = await import("../db/prisma.js");
try { await prisma.$queryRaw`SELECT 1`; } catch {
  console.error("Unattended auto-apply aborted.\nDatabase unavailable.\nDuplicate protection and daily limits cannot be guaranteed.\nApply clicks: 0");
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
}

const [runRepository, applicationRepository, trackingService, { connectToChrome }, { preflightNaukriAuthentication },
  { createJobAgentGraph, initialJobAgentState }, { createProductionDependencies }, { applyToNaukriJob }] = await Promise.all([
  import("../db/runRepository.js"), import("../db/applicationRepository.js"), import("../db/trackingService.js"),
  import("../naukri/browser.js"), import("../naukri/auth.js"), import("../agent/graph.js"),
  import("../agent/productionDependencies.js"), import("../naukri/applyToJob.js"),
]);

const keyword = process.env.JOB_KEYWORD?.trim() || "Frontend Developer";
const location = process.env.JOB_LOCATION?.trim() || "Pune";
let page: Page | undefined;

const result = await runUnattendedAutoApply({
  policy,
  staleMinutes: getDailyStaleMinutes(),
  dependencies: {
    databaseHealthy: async () => { try { await prisma.$queryRaw`SELECT 1`; return true; } catch { return false; } },
    prepareRun: (minutes) => runRepository.prepareAutoApplyRun(minutes),
    createRun: () => runRepository.createAgentRun(keyword, location, prisma, "UNATTENDED_AUTO_APPLY"),
    countAttemptsToday: () => applicationRepository.countApplicationAttemptsToday(),
    connectChrome: async () => { page = (await connectToChrome()).page; },
    authenticationReady: async () => page ? preflightNaukriAuthentication(page) : false,
    loadCandidates: async () => {
      if (!page) throw new Error("CDP_UNAVAILABLE");
      const graph = await createJobAgentGraph(createProductionDependencies(page)).invoke(initialJobAgentState());
      return graph.readyToApplyJobs;
    },
    getDatabaseStatus: async (item) => (await applicationRepository.getApplicationByJob(item.job))?.status ?? null,
    applyOnce: async (item, recordClick) => {
      if (!page) throw new Error("CDP_UNAVAILABLE");
      return applyToNaukriJob(page, item.job, false, recordClick);
    },
    recordActualClick: async (item) => { await applicationRepository.recordApplicationAttempt(item.job, prisma, "UNATTENDED_AUTO_APPLY"); },
    persistResult: async (item, applyResult) => { await applicationRepository.saveUnattendedApplyResult(item.job, applyResult); },
    persistReclassification: async (item) => { await trackingService.markExternalReclassification(item.job); },
    persistFailure: async (item, error) => { await applicationRepository.saveApplicationFailure(item.job, error); },
    completeRun: (id, values) => runRepository.completeAutoApplyRun(id, values).then(() => undefined),
    failRun: (id, reason, values) => runRepository.failAutoApplyRun(id, reason, values).then(() => undefined),
  },
});

function printSummary(value: AutoApplyExecutionResult): void {
  console.log("\n================================");
  console.log("UNATTENDED AUTO-APPLY SUMMARY");
  console.log("================================\n");
  console.log(`Run ID: ${value.runId ?? "None"}`);
  console.log("Enabled: YES");
  console.log(`Daily limit: ${policy.dailyLimit}`);
  console.log(`Hard maximum: ${HARD_AUTO_APPLY_LIMIT}`);
  console.log(`Already attempted today: ${value.alreadyAttemptedToday}`);
  console.log(`Remaining before run: ${value.remainingBeforeRun}`);
  console.log(`Eligible candidates: ${value.candidateJobs}`);
  console.log(`Processed: ${value.attemptedJobs + value.skippedJobs}`);
  console.log(`Live Apply clicks: ${value.attemptedJobs}`);
  console.log(`APPLIED: ${value.appliedJobs}`);
  console.log(`ALREADY_APPLIED: ${value.alreadyAppliedJobs}`);
  console.log(`QUESTIONNAIRE: ${value.questionnaireJobs}`);
  console.log(`NEEDS_INPUT: ${value.needsInputJobs}`);
  console.log(`FAILED: ${value.failedJobs}`);
  console.log(`Stopped early: ${value.stoppedEarly ? "YES" : "NO"}`);
  if (value.reason) console.log(`Reason: ${value.reason}`);
  console.log(`Remaining daily allowance: ${value.remainingDailyAllowance}`);
  console.log("External ATS interactions: 0");
  console.log("Questionnaire submissions: 0");
}

if (result.status === "COMPLETED" && result.remainingBeforeRun === 0) console.log("Daily unattended application limit already reached.\n0 Apply clicks.");
if (result.status === "REFUSED") console.error("Another unattended auto-apply run is already active.\n0 Apply clicks.");
if (result.reason === "CDP_UNAVAILABLE") console.error("CDP_UNAVAILABLE\n0 Apply clicks.");
if (result.reason === "AUTH_REQUIRED") console.error("AUTH_REQUIRED\n0 Apply clicks.");
printSummary(result);
await prisma.$disconnect();
if (result.status === "FAILED" || result.status === "REFUSED") process.exitCode = 1;
