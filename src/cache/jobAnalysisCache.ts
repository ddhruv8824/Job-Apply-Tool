import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DetailedJob } from "../naukri/getJobDetails.js";
import { JobMatchAnalysisSchema, type JobMatchAnalysis } from "../matching/match.schema.js";
import { createHash, isCacheReadEnabled } from "./hash.js";

type JobAnalysisCache = { jobId: string; jobHash: string; createdAt: string; analysis: unknown };

export function jobContentHash(job: DetailedJob): string {
  return createHash(JSON.stringify({ title: job.title, experience: job.experience, description: job.description,
    skills: job.skills, role: job.role, industry: job.industry, employmentType: job.employmentType }));
}

function cacheIdentity(job: DetailedJob): string {
  const id = job.jobId?.trim() || createHash(job.jobUrl).slice(0, 24);
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function cachePath(job: DetailedJob): string {
  return path.resolve(".cache", "job-analysis", `${cacheIdentity(job)}.json`);
}

export async function loadJobAnalysisCache(job: DetailedJob): Promise<JobMatchAnalysis | null> {
  if (!isCacheReadEnabled()) return null;
  try {
    const cached = JSON.parse(await readFile(cachePath(job), "utf8")) as JobAnalysisCache;
    if (cached.jobHash !== jobContentHash(job)) return null;
    return JobMatchAnalysisSchema.parse(cached.analysis);
  } catch {
    return null;
  }
}

export async function saveJobAnalysisCache(job: DetailedJob, analysis: JobMatchAnalysis): Promise<void> {
  const validated = JobMatchAnalysisSchema.parse(analysis);
  const target = cachePath(job);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify({ jobId: job.jobId ?? cacheIdentity(job), jobHash: jobContentHash(job),
    createdAt: new Date().toISOString(), analysis: validated }, null, 2), "utf8");
  await rename(temporary, target);
}
