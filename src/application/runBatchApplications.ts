import { loadEnvFile, stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import type { QuestionnaireQuestion, ResolvedAnswer } from "../questionnaire/types.js";
import type { ReadyToApplyJob } from "./application.js";
import { getBatchMaxApplications, HARD_BATCH_MAX_APPLICATIONS, isBatchDryRun, runControlledBatch, selectEligibleApplications } from "./batch.js";

try { loadEnvFile(); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

function databaseUnavailable(dryRun: boolean): never {
  console.log(dryRun ? "\nBATCH APPLICATION DRY RUN" : "\nCONTROLLED APPLICATION BATCH");
  if (dryRun) {
    console.log("Database history unavailable.");
    console.log("No live application permitted.");
  } else {
    console.log("Live batch requires PostgreSQL application history.");
    console.log("Database unavailable.");
  }
  console.log("No application actions performed.");
  process.exit(1);
}

const dryRun = isBatchDryRun();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) databaseUnavailable(dryRun);

const { prisma } = await import("../db/prisma.js");
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  databaseUnavailable(dryRun);
}

const [
  { createJobAgentGraph, initialJobAgentState },
  { createProductionDependencies },
  { applyToNaukriJob },
  applicationRepository,
  { loadApplicationProfile },
  { runQuestionnaire, isQuestionnaireDryRun },
] = await Promise.all([
  import("../agent/graph.js"),
  import("../agent/productionDependencies.js"),
  import("../naukri/applyToJob.js"),
  import("../db/applicationRepository.js"),
  import("./loadApplicationProfile.js"),
  import("../questionnaire/runQuestionnaire.js"),
]);

const maximum = getBatchMaxApplications();
const dependencies = createProductionDependencies();
const graphResult = await createJobAgentGraph(dependencies).invoke(initialJobAgentState());
const eligible = graphResult.readyToApplyJobs;
const selected = selectEligibleApplications(graphResult.detailedJobs, graphResult.rankedMatches, maximum);

console.log("\n================================");
console.log("READY TO APPLY — BATCH REVIEW");
console.log("================================\n");
console.log(`Eligible jobs: ${eligible.length}`);
console.log(`Phase 9 maximum: ${maximum}`);
console.log(`Hard maximum: ${HARD_BATCH_MAX_APPLICATIONS}\n`);
selected.forEach((item, index) => {
  console.log(`${index + 1}. ${item.job.title}`);
  console.log(`   Company: ${item.job.company}`);
  console.log(`   Score: ${item.match.overallScore}%`);
  console.log(`   Type: ${item.job.applicationType}`);
  console.log("   DB Status: READY_TO_APPLY\n");
});
console.log(`Not selected due to limit: ${Math.max(0, eligible.length - selected.length)}`);
console.log(`BATCH_DRY_RUN=${dryRun}\n`);

if (dryRun) {
  console.log("================================");
  console.log("BATCH APPLICATION DRY RUN");
  console.log("================================\n");
  console.log(`Candidates: ${eligible.length}`);
  console.log(`Configured limit: ${maximum}`);
  console.log(`Selected: ${selected.length}`);
  console.log(`Previously applied removed: ${graphResult.historyStats?.previouslyAppliedSkipped ?? 0}`);
  console.log("Applications attempted: 0");
  console.log("Apply clicks: 0");
  console.log("No applications submitted.");
  await prisma.$disconnect();
  process.exit(0);
}

const terminal = createInterface({ input, output });
let pagePromise: ReturnType<typeof dependencies.getAuthenticatedPage> | undefined;
function getPage() {
  pagePromise ??= dependencies.getAuthenticatedPage();
  return pagePromise;
}

async function processQuestionnaire(item: ReadyToApplyJob): Promise<{ status: string }> {
  if (!graphResult.profile) throw new Error("Candidate profile is unavailable for questionnaire resolution.");
  const page = await getPage();
  const questionnaireResult = await runQuestionnaire({
    page,
    candidateProfile: graphResult.profile,
    applicationProfile: await loadApplicationProfile(),
    dryRun: isQuestionnaireDryRun(),
    prompts: {
      input: async (question) => terminal.question(`Unknown required answer for '${question.text}' (leave blank to keep unresolved): `),
      approve: async () => terminal.question("Proceed with filling and submitting this questionnaire step? (yes/no): "),
      review: (questions: QuestionnaireQuestion[], answers: ResolvedAnswer[], step: number) => {
        console.log(`\nQUESTIONNAIRE REVIEW — STEP ${step}\n`);
        questions.forEach((question, index) => {
          const answer = answers.find((value) => value.questionId === question.id);
          console.log(`${index + 1}. ${question.text}`);
          console.log(`   Answer: ${answer?.answer ?? "UNKNOWN"}`);
          console.log(`   Status: ${answer?.status ?? "NEEDS_INPUT"}`);
        });
      },
    },
  });
  return { status: questionnaireResult.status };
}

try {
  const batchResult = await runControlledBatch({
    jobs: selected,
    dryRun: false,
    prompts: {
      approveBatch: async () => terminal.question("Process this application queue? (yes/no): "),
      approveJob: async (item, index, total, databaseStatus) => {
        console.log("\n================================");
        console.log(`APPLICATION ${index + 1} OF ${total}`);
        console.log("================================\n");
        console.log(`${item.job.title} — ${item.job.company}`);
        console.log(`Score: ${item.match.overallScore}%`);
        console.log(`Current database status: ${databaseStatus ?? "UNKNOWN"}\n`);
        return terminal.question("Apply now? (yes/no/skip/stop): ");
      },
    },
    dependencies: {
      databaseHealthy: async () => { try { await prisma.$queryRaw`SELECT 1`; return true; } catch { return false; } },
      getDatabaseStatus: async (item) => (await applicationRepository.getApplicationByJob(item.job))?.status ?? null,
      hasAlreadyApplied: (item) => applicationRepository.hasAlreadyApplied(item.job),
      applyOnce: async (item, onAttempt) => applyToNaukriJob(await getPage(), item.job, false, async () => {
          await applicationRepository.recordApplicationAttempt(item.job);
          onAttempt();
        }),
      persistApplyResult: async (item, result) => { await applicationRepository.saveApplyResult(item.job, result); },
      runQuestionnaire: processQuestionnaire,
      persistQuestionnaireResult: async (item, result) => { await applicationRepository.saveQuestionnaireResult(item.job, result); },
      persistFailure: async (item, error) => { await applicationRepository.saveApplicationFailure(item.job, error); },
    },
  });

  console.log("\n================================");
  console.log("BATCH COMPLETE");
  console.log("================================\n");
  console.log(`Candidates: ${batchResult.candidates}`);
  console.log(`Actual Apply clicks: ${batchResult.attempted}`);
  console.log(`APPLIED: ${batchResult.applied}`);
  console.log(`ALREADY_APPLIED: ${batchResult.alreadyApplied}`);
  console.log(`NEEDS_INPUT: ${batchResult.needsInput}`);
  console.log(`USER SKIPPED: ${batchResult.skippedByUser}`);
  console.log(`HISTORY SKIPPED: ${batchResult.skippedByHistory}`);
  console.log(`FAILED: ${batchResult.failed}`);
  console.log(`Stopped early: ${batchResult.stoppedEarly ? "YES" : "NO"}`);
  if (batchResult.stopReason) console.log(`Stop reason: ${batchResult.stopReason}`);
  console.log("No external applications performed.");
} finally {
  terminal.close();
  await prisma.$disconnect();
}
