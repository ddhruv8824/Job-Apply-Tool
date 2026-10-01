import type { Locator, Page } from "playwright";
import type { ReadyToApplyJob, ApplyResult } from "../application/application.js";
import { isNaukriAuthenticated } from "./auth.js";
import { detectApplicationType, type ApplicationTypeDetection } from "./applicationType.js";
import type { DetailedJob } from "./getJobDetails.js";

export type PostApplySignals = { applied?: boolean; questionnaire?: boolean; alreadyApplied?: boolean; authRequired?: boolean; visibleQuestions?: number; needsInput?: boolean; humanRequired?: boolean; externalRedirect?: boolean };
export function classifyPostApplySignals(signals: PostApplySignals): ApplyResult {
  if (signals.externalRedirect) return { status: "UNKNOWN", reason: "EXTERNAL_REDIRECT", interactionOccurred: true, message: "Post-click navigation left Naukri." };
  if (signals.humanRequired) return { status: "UNKNOWN", reason: "HUMAN_REQUIRED", interactionOccurred: true, message: "A CAPTCHA, OTP, or human verification challenge was detected." };
  if (signals.authRequired) return { status: "AUTH_REQUIRED", reason: "AUTH_REQUIRED", interactionOccurred: true, message: "Authentication is required." };
  if (signals.alreadyApplied) return { status: "ALREADY_APPLIED", interactionOccurred: true, message: "Naukri indicates this job was already applied to." };
  if (signals.questionnaire) return { status: "QUESTIONNAIRE", interactionOccurred: true, needsInput: signals.needsInput, message: "Application questionnaire detected; no questions were answered.", visibleQuestions: signals.visibleQuestions };
  if (signals.applied) return { status: "APPLIED", interactionOccurred: true, message: "Naukri displayed a successful application state." };
  return { status: "UNKNOWN", reason: "UNKNOWN_POST_CLICK", interactionOccurred: true, message: "The post-click UI could not be classified safely." };
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

export async function applyWithAdapter(adapter: ApplyAdapter, job: DetailedJob, dryRun: boolean, onLiveApplyAttempt?: () => Promise<void>): Promise<ApplyResult> {
  await adapter.open(job);
  if (!(await adapter.isAuthenticated())) return { status: "AUTH_REQUIRED", reason: "AUTH_REQUIRED", interactionOccurred: false, message: "Naukri session is not authenticated." };
  if (!(await adapter.verifyIdentity(job))) return { status: "UNKNOWN", reason: "IDENTITY_MISMATCH", interactionOccurred: false, message: "Opened page does not match the selected job." };
  const application = await adapter.detectType();
  if (application.applicationType !== "NAUKRI_DIRECT") {
    return { status: "UNKNOWN", reason: "LIVE_RECLASSIFIED", interactionOccurred: false, message: `Application type changed to ${application.applicationType}; no click performed.` };
  }
  if (!(await adapter.hasDirectApplyControl())) return { status: "UNKNOWN", reason: "DIRECT_CONTROL_MISSING", interactionOccurred: false, message: "Verified Naukri Apply button was not found." };
  if (dryRun) return { status: "DRY_RUN", message: "Apply button found. No application was submitted." };
  await adapter.clickDirectApplyOnce();
  await onLiveApplyAttempt?.();
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
      let externalRedirect = false;
      try { externalRedirect = !/(^|\.)naukri\.com$/i.test(new URL(page.url()).hostname); } catch { externalRedirect = true; }
      if (externalRedirect) return { externalRedirect: true };
      const humanRequired = page.getByText(/captcha|one[ -]?time password|\botp\b|verify (?:you are human|your identity)|security challenge/i).first();
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
      const requiredUnanswered = questionnaireVisible ? await questionnaire.locator('input[required], select[required], textarea[required], [aria-required="true"]').count() : 0;
      return { authRequired: !authenticated, humanRequired: (await humanRequired.count()) > 0 && await humanRequired.isVisible().catch(() => false), questionnaire: questionnaireVisible, needsInput: requiredUnanswered > 0,
        visibleQuestions: questionnaireVisible ? await questionnaire.locator("label, [role=group], input, select, textarea").count() : undefined,
        alreadyApplied: (await alreadyApplied.count()) > 0 && await alreadyApplied.isVisible().catch(() => false),
        applied: (await applied.count()) > 0 && await applied.isVisible().catch(() => false) };
    },
  };
}

export async function applyToNaukriJob(page: Page, job: DetailedJob, dryRun = true, onLiveApplyAttempt?: () => Promise<void>): Promise<ApplyResult> {
  return applyWithAdapter(createPlaywrightAdapter(page), job, dryRun, onLiveApplyAttempt);
}
