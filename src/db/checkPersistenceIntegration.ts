import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const testUrl = process.env.TEST_DATABASE_URL?.trim();
if (!testUrl) throw new Error("TEST_DATABASE_URL is required for DB integration tests.");
if (testUrl === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not equal DATABASE_URL.");
const databaseName = new URL(testUrl).pathname.toLowerCase();
if (!databaseName.includes("test")) throw new Error("Refusing destructive integration tests: test database name must contain 'test'.");

process.env.DATABASE_URL = testUrl;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testUrl }) });
const { upsertJob } = await import("./jobRepository.js");
const { ensureApplicationStatus, hasAlreadyApplied, recordApplicationAttempt, saveApplyResult, saveMatchResult, saveQuestionnaireResult, countApplicationAttemptsToday } = await import("./applicationRepository.js");
const { createAgentRun, completeAgentRun, failAgentRun, completeAutoApplyRun } = await import("./runRepository.js");

function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const createdJobIds: string[] = [];
const createdRunIds: string[] = [];

try {
  const url = `https://www.naukri.com/frontend-developer-${suffix}-123456789`;
  const first = await upsertJob({ naukriJobId: `id-${suffix}`, jobUrl: url, title: "Frontend Developer", company: "ABC", location: "Pune", applicationType: "NAUKRI_DIRECT" }, db);
  createdJobIds.push(first.id);
  const duplicate = await upsertJob({ naukriJobId: `id-${suffix}`, jobUrl: url, title: "Frontend Developer", company: "ABC", location: "Pune", applicationType: "NAUKRI_DIRECT" }, db);
  expect(first.id === duplicate.id, "naukriJobId dedup failed");

  const fallbackUrl = `https://example.test/jobs/${suffix}`;
  const fallback = await upsertJob({ jobUrl: fallbackUrl, title: "React Developer", company: "XYZ", location: "Not specified", applicationType: "NAUKRI_DIRECT" }, db);
  createdJobIds.push(fallback.id);
  const fallbackDuplicate = await upsertJob({ jobUrl: fallbackUrl, title: "React Developer", company: "XYZ", location: "Not specified", applicationType: "NAUKRI_DIRECT" }, db);
  expect(fallback.id === fallbackDuplicate.id, "jobUrl fallback dedup failed");

  await ensureApplicationStatus(first.id, "APPLIED", db);
  expect(await hasAlreadyApplied({ jobUrl: url }, db), "APPLIED hard skip failed");
  await ensureApplicationStatus(first.id, "DIRECT_FOUND", db);
  expect(await hasAlreadyApplied({ jobUrl: url }, db), "Discovery overwrote permanent status");

  await ensureApplicationStatus(fallback.id, "REVIEW", db);
  expect(!(await hasAlreadyApplied({ jobUrl: fallbackUrl }, db)), "REVIEW was incorrectly blocked");
  await saveMatchResult({ jobUrl: fallbackUrl, title: "React Developer", company: "XYZ", overallScore: 91, skillMatchScore: 91, experienceMatchScore: 91, roleMatchScore: 91, responsibilityMatchScore: 91, skillMatches: [], unknownSkills: [], hardMissingRequirements: [], matchedSkills: [], missingRequiredSkills: [], missingPreferredSkills: [], matchedEvidence: [], strengths: [], concerns: [], recommendation: "APPLY", reason: "test" }, db);
  let application = await db.application.findUniqueOrThrow({ where: { jobId: fallback.id } });
  expect(application.status === "READY_TO_APPLY" && application.matchScore === 91 && application.recommendation === "APPLY", "Match persistence failed");

  await saveApplyResult({ jobUrl: fallbackUrl }, { status: "DRY_RUN" }, db);
  expect((await db.application.findUniqueOrThrow({ where: { jobId: fallback.id } })).attemptCount === 0, "Dry run incremented attempt count");
  const attemptsBefore = await countApplicationAttemptsToday(new Date(), db);
  await recordApplicationAttempt({ jobUrl: fallbackUrl }, db, "UNATTENDED_AUTO_APPLY");
  application = await db.application.findUniqueOrThrow({ where: { jobId: fallback.id } });
  expect(application.attemptCount === 1 && application.lastAttemptAt !== null, "Live attempt was not counted exactly once");
  expect(await countApplicationAttemptsToday(new Date(), db) === attemptsBefore + 1, "Append-only daily attempt counting failed");
  await saveApplyResult({ jobUrl: fallbackUrl }, { status: "QUESTIONNAIRE" }, db);
  expect((await db.application.findUniqueOrThrow({ where: { jobId: fallback.id } })).questionnaireDetected, "Questionnaire detection was not persisted");
  await saveQuestionnaireResult({ jobUrl: fallbackUrl }, { status: "NEEDS_INPUT" }, db);
  expect((await db.application.findUniqueOrThrow({ where: { jobId: fallback.id } })).status === "NEEDS_INPUT", "NEEDS_INPUT was not persisted");
  await saveQuestionnaireResult({ jobUrl: fallbackUrl }, { status: "APPLIED" }, db);
  application = await db.application.findUniqueOrThrow({ where: { jobId: fallback.id } });
  expect(application.status === "APPLIED" && application.appliedAt !== null, "APPLIED result was not persisted");

  const run = await createAgentRun("Frontend", "Pune", db); createdRunIds.push(run.id);
  await completeAgentRun(run.id, { totalJobs: 2, directJobs: 2, externalJobs: 0, walkInJobs: 0, unknownJobs: 0, analyzedJobs: 1, apply: 1, review: 0, skip: 0, previouslyAppliedSkipped: 1 }, db);
  expect((await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).status === "COMPLETED", "AgentRun completion failed");
  const failedRun = await createAgentRun("Frontend", "Pune", db); createdRunIds.push(failedRun.id);
  await failAgentRun(failedRun.id, new Error("safe failure"), db);
  expect((await db.agentRun.findUniqueOrThrow({ where: { id: failedRun.id } })).status === "FAILED", "AgentRun failure failed");

  const autoRun = await createAgentRun("Frontend", "Pune", db, "UNATTENDED_AUTO_APPLY"); createdRunIds.push(autoRun.id);
  await completeAutoApplyRun(autoRun.id, { candidateJobs: 3, attemptedJobs: 2, appliedJobs: 1, alreadyAppliedJobs: 0,
    questionnaireJobs: 1, needsInputJobs: 1, skippedJobs: 1, failedJobs: 0 }, db);
  const completedAutoRun = await db.agentRun.findUniqueOrThrow({ where: { id: autoRun.id } });
  expect(completedAutoRun.status === "COMPLETED" && completedAutoRun.attemptedJobs === 2 && completedAutoRun.questionnaireJobs === 1,
    "Unattended AgentRun counters failed");

  console.log("PostgreSQL repository integration tests: PASSED");
} finally {
  for (const id of createdJobIds) await db.job.delete({ where: { id } }).catch(() => undefined);
  for (const id of createdRunIds) await db.agentRun.delete({ where: { id } }).catch(() => undefined);
  await db.$disconnect();
}
