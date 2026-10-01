import type { ApplicationType, Job as PersistedJob, Prisma } from "../generated/prisma/client.js";
import { extractHiristJobId } from "../hirist/api.js";
import type { Job } from "../hirist/searchJobs.js";
import type { DatabaseClient } from "./prisma.js";
import { prisma } from "./prisma.js";

export type PersistJobInput = Job & { applicationType: ApplicationType; hiristJobId?: string };

function data(input: PersistJobInput): Prisma.JobCreateInput {
  return {
    hiristJobId: input.hiristJobId ?? input.jobId ?? extractHiristJobId(input.jobUrl),
    jobUrl: input.jobUrl,
    title: input.title,
    company: input.company,
    location: input.location,
    applicationType: input.applicationType,
  };
}

export async function upsertJob(input: PersistJobInput, db: DatabaseClient = prisma): Promise<PersistedJob> {
  const values = data(input);
  const identity = values.hiristJobId
    ? { OR: [{ hiristJobId: values.hiristJobId }, { jobUrl: values.jobUrl }] }
    : { jobUrl: values.jobUrl };
  const existing = await db.job.findFirst({ where: identity });
  if (existing) {
    return db.job.update({ where: { id: existing.id }, data: {
      hiristJobId: values.hiristJobId,
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
  const hiristJobId = job.jobId ?? extractHiristJobId(job.jobUrl);
  return db.job.findFirst({
    where: hiristJobId ? { OR: [{ hiristJobId }, { jobUrl: job.jobUrl }] } : { jobUrl: job.jobUrl },
    include: { application: true },
  });
}
