import type { ApplicationType, Job as PersistedJob, Prisma } from "../generated/prisma/client.js";
import type { Job } from "../naukri/searchJobs.js";
import type { DatabaseClient } from "./prisma.js";
import { prisma } from "./prisma.js";

export type PersistJobInput = Job & { applicationType: ApplicationType; naukriJobId?: string };

export function extractNaukriJobId(jobUrl: string): string | undefined {
  try {
    const path = new URL(jobUrl).pathname;
    return path.match(/-(\d+)\/?$/)?.[1];
  } catch {
    return undefined;
  }
}

function data(input: PersistJobInput): Prisma.JobCreateInput {
  return {
    naukriJobId: input.naukriJobId ?? extractNaukriJobId(input.jobUrl),
    jobUrl: input.jobUrl,
    title: input.title,
    company: input.company,
    location: input.location,
    applicationType: input.applicationType,
  };
}

export async function upsertJob(input: PersistJobInput, db: DatabaseClient = prisma): Promise<PersistedJob> {
  const values = data(input);
  const identity = values.naukriJobId
    ? { OR: [{ naukriJobId: values.naukriJobId }, { jobUrl: values.jobUrl }] }
    : { jobUrl: values.jobUrl };
  const existing = await db.job.findFirst({ where: identity });
  if (existing) {
    return db.job.update({ where: { id: existing.id }, data: {
      naukriJobId: values.naukriJobId,
      jobUrl: values.jobUrl,
      title: values.title,
      company: values.company,
      location: values.location,
      applicationType: values.applicationType,
    } });
  }
  try {
    return await db.job.create({ data: values });
  } catch (error) {
    const raced = await db.job.findFirst({ where: identity });
    if (raced) return raced;
    throw error;
  }
}

export async function getJobHistory(job: Pick<Job, "jobUrl"> & { jobId?: string }, db: DatabaseClient = prisma) {
  const naukriJobId = job.jobId ?? extractNaukriJobId(job.jobUrl);
  return db.job.findFirst({
    where: naukriJobId ? { OR: [{ naukriJobId }, { jobUrl: job.jobUrl }] } : { jobUrl: job.jobUrl },
    include: { application: true },
  });
}
