import type { HiristClient, HiristJobDetailRaw } from "./api.js";
import { classifyHiristJob, type ApplicationType } from "./applicationType.js";
import { formatExperience, formatLocation, hiristJobUrl, type Job } from "./searchJobs.js";

export type DetailedJob = Job & {
  description: string;
  skills?: string[];
  /** Tags the recruiter marked mandatory on Hirist. */
  mandatorySkills?: string[];
  role?: string;
  industry?: string;
  department?: string;
  employmentType?: string;
  roleCategory?: string;
  education?: string[];
  postedDate?: string;
  openings?: string;
  jobId?: string;
  applicationType: ApplicationType;
  applicationLabel?: string;
  externalApplicationUrl?: string;
  screeningRequired?: boolean;
};

const MIN_DESCRIPTION_LENGTH = 100;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", bull: "-" };

/** Converts Hirist's JD HTML to plain text, keeping line and paragraph breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/\s*(p|div|li|ul|ol|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => ENTITIES[name.toLowerCase()] ?? entity)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t  ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueNames(values: string[]): string[] | undefined {
  const unique = new Map<string, string>();
  for (const value of values.map((item) => item.trim()).filter(Boolean)) unique.set(value.toLocaleLowerCase(), value);
  return unique.size ? [...unique.values()] : undefined;
}

/** Builds a DetailedJob from Hirist's detail payload; throws when the JD is unusable. */
export function mapJobDetail(job: Job, detail: HiristJobDetailRaw): DetailedJob {
  const description = htmlToText(detail.introText ?? "");
  if (description.length < MIN_DESCRIPTION_LENGTH) {
    throw new Error(`description was missing or too short (${description.length} characters)`);
  }
  const tags = detail.tags ?? [];
  return {
    ...job,
    jobId: String(detail.id),
    title: detail.title?.trim() || job.title,
    company: detail.companyData?.companyName?.trim() || job.company,
    location: formatLocation(detail),
    experience: formatExperience(detail.min, detail.max) ?? job.experience,
    jobUrl: job.jobUrl || hiristJobUrl(detail),
    description,
    skills: uniqueNames(tags.map((tag) => tag.name)),
    mandatorySkills: uniqueNames(tags.filter((tag) => tag.isMandatory).map((tag) => tag.name)),
    role: detail.jobdesignation?.trim() || undefined,
    industry: detail.industry?.trim() || undefined,
    employmentType: detail.workFromHome ? "Work from home possible" : undefined,
    postedDate: detail.createdTimeMs ? new Date(detail.createdTimeMs).toISOString().slice(0, 10) : undefined,
    ...classifyHiristJob(detail),
  };
}

/** Fetches one Hirist job through the API and extracts its complete description. */
export async function getJobDetails(client: HiristClient, job: Job): Promise<DetailedJob | null> {
  try {
    if (!job.jobId) throw new Error("job has no Hirist job id");
    const detail = await client.jobDetail(job.jobId);
    if (!detail) throw new Error("Hirist returned no job detail (removed or unavailable)");
    return mapJobDetail(job, detail);
  } catch (error) {
    console.warn(`Description extraction failed: ${job.title} — ${job.company}`);
    console.warn(`URL: ${job.jobUrl}`);
    console.warn(error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Extracts job details sequentially; failures remain isolated. */
export async function getJobsDetails(client: HiristClient, jobs: Job[]): Promise<DetailedJob[]> {
  const results: DetailedJob[] = [];

  for (const [index, job] of jobs.entries()) {
    console.log(`[${index + 1}/${jobs.length}] ${job.title} — ${job.company}`);
    const detailedJob = await getJobDetails(client, job);
    if (!detailedJob) {
      console.log("Status: FAILED\n");
      continue;
    }
    results.push(detailedJob);
    console.log("Status: OK");
    console.log(`Description: ${detailedJob.description.length} chars`);
    console.log(`Skills: ${detailedJob.skills?.length ?? 0} (${detailedJob.mandatorySkills?.length ?? 0} mandatory)`);
    console.log(`Application type: ${detailedJob.applicationType}${detailedJob.screeningRequired ? " (screening)" : ""}\n`);
  }

  return results;
}
