import type { Locator, Page } from "playwright";
import { isNaukriAuthenticated } from "./auth.js";
import type { Job } from "./searchJobs.js";
import { detectApplicationType, type ApplicationType } from "./applicationType.js";

export type DetailedJob = Job & {
  description: string;
  skills?: string[];
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
};

const MIN_DESCRIPTION_LENGTH = 100;

/** Cleans DOM formatting while retaining meaningful line and paragraph breaks. */
function normalizeDescription(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t\u00a0 ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function optionalText(locator: Locator): Promise<string | undefined> {
  if ((await locator.count()) === 0) return undefined;
  const text = (await locator.first().innerText()).trim();
  return text || undefined;
}

async function extractSkills(page: Page): Promise<string[] | undefined> {
  const rawSkills = await page
    .locator('[class^="styles_key-skill__"] a')
    .allInnerTexts();
  const unique = new Map<string, string>();

  for (const rawSkill of rawSkills) {
    const skill = rawSkill.trim();
    if (skill) unique.set(skill.toLocaleLowerCase(), skill);
  }

  const skills = [...unique.values()];
  return skills.length > 0 ? skills : undefined;
}

async function extractLabeledDetails(
  page: Page
): Promise<Map<string, string>> {
  const rows = await page
    .locator('[class^="styles_other-details__"] > [class^="styles_details__"]')
    .allInnerTexts();
  const details = new Map<string, string>();

  for (const row of rows) {
    const separator = row.indexOf(":");
    if (separator < 0) continue;
    const label = row.slice(0, separator).trim();
    const value = row
      .slice(separator + 1)
      .trim()
      .replace(/,\s*$/, "");
    if (label && value) details.set(label, value);
  }

  return details;
}

async function extractEducation(page: Page): Promise<string[] | undefined> {
  const rows = await page
    .locator('[class^="styles_education__"] > [class^="styles_details__"]')
    .allInnerTexts();
  const education = rows.map((row) => row.trim()).filter(Boolean);
  return education.length > 0 ? education : undefined;
}

async function extractHeaderValue(
  page: Page,
  label: string
): Promise<string | undefined> {
  return optionalText(
    page
      .getByText(label, { exact: true })
      .first()
      .locator("..").locator(":scope > span")
  );
}

/** Opens one Naukri job and extracts only its complete description. */
export async function getJobDetails(
  page: Page,
  job: Job
): Promise<DetailedJob | null> {
  try {
    const response = await page.goto(job.jobUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const currentUrl = new URL(page.url());
    if (currentUrl.hostname !== "www.naukri.com") {
      throw new Error(`navigation left Naukri: ${page.url()}`);
    }
    if (/login|register/i.test(currentUrl.pathname)) {
      throw new Error("authentication may have expired: redirected to login");
    }
    if (response && !response.ok()) {
      throw new Error(`job detail request returned HTTP ${response.status()}`);
    }
    if (!(await isNaukriAuthenticated(page, 30_000))) {
      throw new Error("authentication could not be confirmed after navigation");
    }

    const heading = page.getByText("Job description", { exact: true }).first();
    await heading.waitFor({ state: "visible", timeout: 30_000 });

    // Live DOM: the heading wrapper's next sibling groups the narrative JD
    // with separate metadata children. This class identifies only the JD;
    // role/industry and education remain out of Checkpoint 3's description.
    const descriptionContainer = heading
      .locator("xpath=../following-sibling::div[1]")
      .locator('[class^="styles_JDC__dang-inner-html"]');
    await descriptionContainer.waitFor({ state: "visible", timeout: 30_000 });

    const description = normalizeDescription(
      await descriptionContainer.innerText()
    );
    if (description.length < MIN_DESCRIPTION_LENGTH) {
      throw new Error(
        `description was missing or too short (${description.length} characters)`
      );
    }

    const details = await extractLabeledDetails(page);
    const jobId = new URL(page.url()).pathname.match(/-(\d+)\/?$/)?.[1];
    const application = await detectApplicationType(page);

    return {
      ...job,
      description,
      skills: await extractSkills(page),
      role: details.get("Role"),
      industry: details.get("Industry Type"),
      department: details.get("Department"),
      employmentType: details.get("Employment Type"),
      roleCategory: details.get("Role Category"),
      education: await extractEducation(page),
      postedDate: await extractHeaderValue(page, "Posted:"),
      openings: await extractHeaderValue(page, "Openings:"),
      jobId,
      ...application,
    };
  } catch (error) {
    console.warn(`Description extraction failed: ${job.title} — ${job.company}`);
    console.warn(`URL: ${job.jobUrl}`);
    console.warn(error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Extracts job details sequentially on one page; failures remain isolated. */
export async function getJobsDetails(
  page: Page,
  jobs: Job[]
): Promise<DetailedJob[]> {
  const results: DetailedJob[] = [];

  for (const [index, job] of jobs.entries()) {
    console.log(`[${index + 1}/${jobs.length}] ${job.title} — ${job.company}`);

    try {
      const detailedJob = await getJobDetails(page, job);
      if (!detailedJob) {
        console.log("Status: FAILED\n");
        continue;
      }

      results.push(detailedJob);
      console.log("Status: OK");
      console.log(`Description: ${detailedJob.description.length} chars`);
      console.log(`Skills: ${detailedJob.skills?.length ?? 0}`);
      console.log(`Application type: ${detailedJob.applicationType}\n`);
    } catch (error) {
      // Defensive isolation: getJobDetails normally converts failures to null,
      // but an unexpected error must not stop the remaining jobs.
      console.warn("Status: FAILED");
      console.warn(error instanceof Error ? error.message : String(error));
      console.log();
    }
  }

  return results;
}
