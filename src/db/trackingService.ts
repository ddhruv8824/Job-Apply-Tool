import type { MatchResult } from "../matching/match.schema.js";
import type { DirectJobDiscoveryResult } from "../naukri/discoverDirectJobs.js";
import type { Job } from "../naukri/searchJobs.js";
import type { DatabaseClient } from "./prisma.js";
import { prisma } from "./prisma.js";
import { ensureApplicationStatus, hasAlreadyApplied, saveMatchResult } from "./applicationRepository.js";
import { upsertJob } from "./jobRepository.js";

export type HistoryFilterResult = { processableJobs: Job[]; previouslyAppliedJobs: Job[] };

export async function persistDiscovery(result: DirectJobDiscoveryResult, db: DatabaseClient = prisma): Promise<void> {
  for (const job of result.directJobs) {
    const persisted = await upsertJob({ ...job, applicationType: "NAUKRI_DIRECT" }, db);
    await ensureApplicationStatus(persisted.id, "DIRECT_FOUND", db);
  }
  for (const job of result.manualJobs) {
    const persisted = await upsertJob(job, db);
    const status = job.applicationType === "EXTERNAL_COMPANY" ? "EXTERNAL_SKIPPED" : "UNKNOWN";
    await ensureApplicationStatus(persisted.id, status, db);
  }
}

export async function filterPreviouslyApplied(jobs: Job[], db: DatabaseClient = prisma): Promise<HistoryFilterResult> {
  const processableJobs: Job[] = [];
  const previouslyAppliedJobs: Job[] = [];
  for (const job of jobs) {
    if (await hasAlreadyApplied(job, db)) previouslyAppliedJobs.push(job);
    else processableJobs.push(job);
  }
  return { processableJobs, previouslyAppliedJobs };
}

export async function saveMatchResults(matches: MatchResult[], db: DatabaseClient = prisma): Promise<void> {
  for (const match of matches) await saveMatchResult(match, db);
}

export async function markExternalReclassification(job: Job, db: DatabaseClient = prisma): Promise<void> {
  const persisted = await upsertJob({ ...job, applicationType: "EXTERNAL_COMPANY" }, db);
  await ensureApplicationStatus(persisted.id, "EXTERNAL_SKIPPED", db);
}
