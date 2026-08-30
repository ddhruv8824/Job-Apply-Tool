import { loadEnvFile } from "node:process";
import type { Page } from "playwright";
import { getDailyMaxReadyJobs, getDailyStaleMinutes, runDailyExecution } from "./daily.js";
import { sanitizeOperationalError } from "../db/sanitize.js";

try { loadEnvFile(); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error("Daily run aborted.\nDatabase unavailable.\nNo browser or AI activity performed.");
  process.exit(1);
}

let prismaModule: Awaited<ReturnType<typeof importPrisma>>;
async function importPrisma() { return import("../db/prisma.js"); }
try { prismaModule = await importPrisma(); }
catch {
  console.error("Daily run aborted.\nDatabase unavailable.\nNo browser or AI activity performed.");
  process.exit(1);
}
const { prisma } = prismaModule;
const [runRepository, { connectToChrome }, { preflightNaukriAuthentication }, { createJobAgentGraph, initialJobAgentState }, { createProductionDependencies }] = await Promise.all([
  import("../db/runRepository.js"),
  import("../naukri/browser.js"),
  import("../naukri/auth.js"),
  import("../agent/graph.js"),
  import("../agent/productionDependencies.js"),
]);

const keyword = process.env.JOB_KEYWORD?.trim() || "Frontend Developer";
const location = process.env.JOB_LOCATION?.trim() || "Pune";
let page: Page | undefined;

const result = await runDailyExecution({
  maxReadyJobs: getDailyMaxReadyJobs(),
  staleMinutes: getDailyStaleMinutes(),
  dependencies: {
    databaseHealthy: async () => { try { await prisma.$queryRaw`SELECT 1`; return true; } catch { return false; } },
    prepareDailyRun: (minutes) => runRepository.prepareDailyRun(minutes),
    createRun: () => runRepository.createAgentRun(keyword, location, prisma, "DAILY_DISCOVERY"),
    connectChrome: async () => { page = (await connectToChrome()).page; },
    authenticationReady: async () => page ? preflightNaukriAuthentication(page) : false,
    runPipeline: async () => {
      if (!page) throw new Error("CDP_UNAVAILABLE");
      return createJobAgentGraph(createProductionDependencies(page)).invoke(initialJobAgentState());
    },
    completeRun: async (id, summary, readyCount) => { await runRepository.completeDailyAgentRun(id, summary, readyCount); },
    failRun: async (id, reason) => { await runRepository.failAgentRun(id, reason); },
  },
}).catch(async (error) => {
  console.error(`Daily run failed: ${sanitizeOperationalError(error)}`);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});

if (result.status === "REFUSED") {
  console.error("Another daily run is already active.");
  await prisma.$disconnect();
  process.exit(1);
}
if (result.status === "FAILED") {
  if (result.reason === "DATABASE_UNAVAILABLE") console.error("Daily run aborted.\nDatabase unavailable.\nNo browser or AI activity performed.");
  else if (result.reason === "CDP_UNAVAILABLE") console.error("Chrome CDP unavailable.\nStart the manually managed Naukri Chrome profile.\nNo application actions performed.");
  else if (result.reason === "AUTH_REQUIRED") console.error("Naukri authentication required.\nNo application actions performed.");
  else console.error(`Daily run failed: ${result.reason ?? "UNKNOWN"}`);
  await prisma.$disconnect();
  process.exit(1);
}

const graph = result.graphResult!;
const summary = graph.summary!;
console.log("\n================================");
console.log("DAILY JOB AGENT SUMMARY");
console.log("================================\n");
console.log(`Run ID: ${result.runId}`);
console.log(`Search: ${keyword} / ${location}`);
console.log(`Pages visited: ${graph.discovery?.pagesVisited ?? 0}`);
console.log(`Jobs inspected: ${summary.totalJobs}`);
console.log(`Direct jobs: ${summary.directJobs}`);
console.log(`External jobs: ${summary.externalJobs}`);
console.log(`Previously applied skipped: ${summary.previouslyAppliedSkipped}`);
console.log(`Processed: ${graph.processableDirectJobs.length}`);
console.log(`AI matched: ${summary.analyzedJobs}`);
console.log(`READY_TO_APPLY: ${result.readyJobs.length}`);
console.log(`REVIEW: ${summary.review}`);
console.log(`SKIP: ${summary.skip}`);
console.log("Applications submitted: 0");
console.log("Reason: Scheduled discovery mode does not submit applications.");

console.log("\n================================");
console.log("READY TO APPLY");
console.log("================================\n");
if (!result.readyJobs.length) console.log("None\n");
for (const item of result.readyJobs) {
  console.log(`${item.job.title} — ${item.job.company}`);
  console.log(`Score: ${item.match.overallScore}%`);
  console.log("Status: READY_TO_APPLY\n");
}
console.log("To review/apply manually:\n\nnpm run apply:batch");
await prisma.$disconnect();
