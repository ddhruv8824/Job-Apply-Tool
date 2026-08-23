import type { Locator, Page } from "playwright";
import type { ReadyToApplyJob, ApplyResult } from "../application/application.js";
import { isNaukriAuthenticated } from "./auth.js";
import { detectApplicationType, type ApplicationTypeDetection } from "./applicationType.js";
import type { DetailedJob } from "./getJobDetails.js";

export type PostApplySignals = { applied?: boolean; questionnaire?: boolean; alreadyApplied?: boolean; authRequired?: boolean; visibleQuestions?: number };
export function classifyPostApplySignals(signals: PostApplySignals): ApplyResult {
  if (signals.authRequired) return { status: "AUTH_REQUIRED", message: "Authentication is required." };
  if (signals.alreadyApplied) return { status: "ALREADY_APPLIED", message: "Naukri indicates this job was already applied to." };
  if (signals.questionnaire) return { status: "QUESTIONNAIRE", message: "Application questionnaire detected; no questions were answered.", visibleQuestions: signals.visibleQuestions };
  if (signals.applied) return { status: "APPLIED", message: "Naukri displayed a successful application state." };
  return { status: "UNKNOWN", message: "The post-click UI could not be classified safely." };
}

export type ApplyAdapter = {
  open: (job: DetailedJob) => Promise<void>;
  isAuthenticated: () => Promise<boolean>;
  verifyIdentity: (job: DetailedJob) => Promise<boolean>;
  detectType: () => Promise<ApplicationTypeDetection>;
  hasDirectApplyControl: () => Promise<boolean>;
  clickDirectApplyOnce: () => Promise<void>;
  inspectResult: () => Promise<PostApplySignals>;
};

export async function applyWithAdapter(adapter: ApplyAdapter, job: DetailedJob, dryRun: boolean): Promise<ApplyResult> {
  await adapter.open(job);
  if (!(await adapter.isAuthenticated())) return { status: "AUTH_REQUIRED", message: "Naukri session is not authenticated." };
  if (!(await adapter.verifyIdentity(job))) return { status: "UNKNOWN", message: "Opened page does not match the selected job." };
  const application = await adapter.detectType();
  if (application.applicationType !== "NAUKRI_DIRECT") {
    return { status: "UNKNOWN", message: `Application type changed to ${application.applicationType}; no click performed.` };
  }
  if (!(await adapter.hasDirectApplyControl())) return { status: "UNKNOWN", message: "Verified Naukri Apply button was not found." };
  if (dryRun) return { status: "DRY_RUN", message: "Apply button found. No application was submitted." };
  await adapter.clickDirectApplyOnce();
  return classifyPostApplySignals(await adapter.inspectResult());
}

function normalized(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

function createPlaywrightAdapter(page: Page): ApplyAdapter {
  let directApply: Locator | undefined;
  return {
    open: async (job) => { await page.goto(job.jobUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }); },
    isAuthenticated: () => isNaukriAuthenticated(page, 30_000),
    verifyIdentity: async (job) => {
      const currentId = new URL(page.url()).pathname.match(/-(\d+)\/?$/)?.[1];
      if (job.jobId && currentId && job.jobId !== currentId) return false;
      const visibleTitle = ((await page.locator("h1.styles_jd-header-title__rZwM1").first().textContent().catch(() => null)) ?? "").trim();
      const expected = normalized(job.title); const actual = normalized(visibleTitle);
      if (!actual || !(actual.includes(expected) || expected.includes(actual))) return false;
      if (job.jobId && currentId) return true;
      return (await page.getByText(job.company, { exact: true }).count()) > 0;
    },
    detectType: () => detectApplicationType(page),
    hasDirectApplyControl: async () => {
      if ((await page.locator("button#company-site-button.company-site-button:visible").count()) > 0) return false;
      directApply = page.locator("button#apply-button.apply-button:visible").filter({ hasText: /^\s*Apply\s*$/ }).first();
      return (await directApply.count()) > 0;
    },
    clickDirectApplyOnce: async () => {
      if (!directApply) throw new Error("Direct Apply control was not verified.");
      await directApply.click();
    },
    inspectResult: async () => {
      const questionnaire = page.locator('[role="dialog"], form').filter({ hasText: /question|answer|required|screening/i });
      const alreadyApplied = page.getByText(/already applied|applied previously/i).first();
      const applied = page.getByText(/successfully applied|application sent|application submitted|^applied$/i).first();
      await Promise.race([
        questionnaire.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
        alreadyApplied.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
        applied.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
      ]);
      const authenticated = await isNaukriAuthenticated(page);
      const questionnaireVisible = (await questionnaire.count()) > 0 && await questionnaire.first().isVisible().catch(() => false);
      return { authRequired: !authenticated, questionnaire: questionnaireVisible,
        visibleQuestions: questionnaireVisible ? await questionnaire.locator("label, [role=group], input, select, textarea").count() : undefined,
        alreadyApplied: (await alreadyApplied.count()) > 0 && await alreadyApplied.isVisible().catch(() => false),
        applied: (await applied.count()) > 0 && await applied.isVisible().catch(() => false) };
    },
  };
}

export async function applyToNaukriJob(page: Page, job: DetailedJob, dryRun = true): Promise<ApplyResult> {
  return applyWithAdapter(createPlaywrightAdapter(page), job, dryRun);
}
