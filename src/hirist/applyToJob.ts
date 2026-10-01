import type { Locator, Page } from "playwright";
import type { ApplyResult } from "../application/application.js";
import { createHiristClient, extractHiristJobId, isHiristHost, pageTransport } from "./api.js";
import { isHiristAuthenticated } from "./auth.js";
import { classifyHiristJob, type ApplicationTypeDetection } from "./applicationType.js";
import type { DetailedJob } from "./getJobDetails.js";

export type PostApplySignals = {
  applied?: boolean; questionnaire?: boolean; alreadyApplied?: boolean; authRequired?: boolean; visibleQuestions?: number;
  needsInput?: boolean; humanRequired?: boolean; externalRedirect?: boolean; profileIncomplete?: boolean;
  /** Hirist's "Review & Submit" confirmation step is open; nothing has been submitted yet. */
  reviewStep?: boolean;
  /** The review step has an empty field (e.g. expected salary) that must be filled by a human. */
  reviewNeedsInput?: boolean;
};

export function classifyPostApplySignals(signals: PostApplySignals): ApplyResult {
  if (signals.externalRedirect) return { status: "UNKNOWN", reason: "EXTERNAL_REDIRECT", interactionOccurred: true, message: "Post-click navigation left Hirist." };
  if (signals.humanRequired) return { status: "UNKNOWN", reason: "HUMAN_REQUIRED", interactionOccurred: true, message: "A CAPTCHA, OTP, or human verification challenge was detected." };
  if (signals.authRequired) return { status: "AUTH_REQUIRED", reason: "AUTH_REQUIRED", interactionOccurred: true, message: "Authentication is required." };
  if (signals.profileIncomplete) return { status: "UNKNOWN", reason: "PROFILE_INCOMPLETE", interactionOccurred: true, message: "Hirist redirected to profile registration. Complete your Hirist profile manually, then retry." };
  if (signals.alreadyApplied) return { status: "ALREADY_APPLIED", interactionOccurred: true, message: "Hirist indicates this job was already applied to." };
  if (signals.applied) return { status: "APPLIED", interactionOccurred: true, message: "Hirist displayed a successful application state." };
  if (signals.questionnaire) return { status: "QUESTIONNAIRE", interactionOccurred: true, needsInput: signals.needsInput, message: "Hirist screening questionnaire detected; no questions were answered.", visibleQuestions: signals.visibleQuestions };
  if (signals.reviewStep && signals.reviewNeedsInput) return { status: "QUESTIONNAIRE", interactionOccurred: true, needsInput: true, message: "Hirist's Review & Submit step needs input (for example expected salary); nothing was submitted." };
  return { status: "UNKNOWN", reason: "UNKNOWN_POST_CLICK", interactionOccurred: true, message: "The post-click UI could not be classified safely." };
}

export type ApplyAdapter = {
  open: (job: DetailedJob) => Promise<void>;
  isAuthenticated: () => Promise<boolean>;
  verifyIdentity: (job: DetailedJob) => Promise<boolean>;
  detectType: () => Promise<ApplicationTypeDetection>;
  isAlreadyApplied: () => Promise<boolean>;
  hasDirectApplyControl: () => Promise<boolean>;
  clickDirectApplyOnce: () => Promise<void>;
  inspectResult: () => Promise<PostApplySignals>;
  /** Clicks the single verified submit control of the review step. Returns false when none was found. */
  confirmReviewOnce: () => Promise<boolean>;
};

export async function applyWithAdapter(adapter: ApplyAdapter, job: DetailedJob, dryRun: boolean, onLiveApplyAttempt?: () => Promise<void>): Promise<ApplyResult> {
  await adapter.open(job);
  if (!(await adapter.isAuthenticated())) return { status: "AUTH_REQUIRED", reason: "AUTH_REQUIRED", interactionOccurred: false, message: "Hirist session is not authenticated." };
  if (!(await adapter.verifyIdentity(job))) return { status: "UNKNOWN", reason: "IDENTITY_MISMATCH", interactionOccurred: false, message: "Opened page does not match the selected job." };
  const application = await adapter.detectType();
  if (application.applicationType !== "HIRIST_DIRECT") {
    return { status: "UNKNOWN", reason: "LIVE_RECLASSIFIED", interactionOccurred: false, message: `Application type changed to ${application.applicationType}; no click performed.` };
  }
  if (await adapter.isAlreadyApplied()) return { status: "ALREADY_APPLIED", interactionOccurred: false, message: "Hirist shows this job as already applied; no click performed." };
  if (!(await adapter.hasDirectApplyControl())) return { status: "UNKNOWN", reason: "DIRECT_CONTROL_MISSING", interactionOccurred: false, message: "Verified Hirist Apply button was not found." };
  if (dryRun) return { status: "DRY_RUN", message: "Apply button found. No application was submitted." };
  await adapter.clickDirectApplyOnce();
  await onLiveApplyAttempt?.();

  const signals = await adapter.inspectResult();
  const outcome = classifyPostApplySignals({ ...signals, reviewStep: false, reviewNeedsInput: false });
  if (!signals.reviewStep || outcome.reason !== "UNKNOWN_POST_CLICK") return outcome;
  if (signals.reviewNeedsInput) return classifyPostApplySignals(signals);

  // Hirist's Apply opens a Review & Submit step; its single submit control completes this same attempt.
  if (!(await adapter.confirmReviewOnce())) {
    return { status: "UNKNOWN", reason: "REVIEW_CONFIRM_MISSING", interactionOccurred: true, message: "Review & Submit step opened but no single verified submit control was found; nothing was submitted." };
  }
  const confirmed = await adapter.inspectResult();
  if (confirmed.reviewStep && !confirmed.applied) {
    return { status: "UNKNOWN", reason: "UNKNOWN_POST_CLICK", interactionOccurred: true, message: "Review & Submit step was still open after one confirmation." };
  }
  return classifyPostApplySignals(confirmed);
}

function normalized(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

async function visible(locator: Locator): Promise<boolean> {
  return (await locator.count()) > 0 && await locator.first().isVisible().catch(() => false);
}

const APPLY_BUTTON = /^\s*Apply\s*$/;
const REVIEW_TEXT = /Review\s*&\s*Submit|Review your Application|You are Applying to/i;
const REVIEW_SUBMIT_IN_DIALOG = /^\s*(?:review\s*&\s*submit|submit|submit application|confirm\s*(?:&|and)\s*apply|apply|send application)\s*$/i;
const REVIEW_SUBMIT_ON_PAGE = /^\s*(?:review\s*&\s*submit|submit)\s*$/i;
const INSPECT_TIMEOUT_MS = 20_000;

function createPlaywrightAdapter(page: Page): ApplyAdapter {
  const client = createHiristClient(pageTransport(page), { minIntervalMs: 0 });
  let directApply: Locator | undefined;
  let jobId: string | undefined;

  const reviewDialog = () => page.locator('[role="dialog"]:visible').filter({ hasText: REVIEW_TEXT });
  const onReviewPage = () => { try { return /\/job\/\d+\/review-apply/.test(new URL(page.url()).pathname); } catch { return false; } };

  async function readSignals(): Promise<PostApplySignals | null> {
    let url: URL;
    try { url = new URL(page.url()); } catch { return { externalRedirect: true }; }
    if (!isHiristHost(url.hostname)) return { externalRedirect: true };
    if (url.pathname.startsWith("/registration")) return { profileIncomplete: true };
    if (/\/job\/\d+\/screening/.test(url.pathname)) return { questionnaire: true, needsInput: true };
    if (/\/job\/\d+\/already-applied/.test(url.pathname)) return { alreadyApplied: true };
    if (url.pathname.startsWith("/job/applied")) return { applied: true };
    if (await visible(page.getByText(/job applied successfully|successfully applied|application (?:sent|submitted)/i))) return { applied: true };
    if (await visible(page.getByText(/already applied/i))) return { alreadyApplied: true };
    if (await visible(page.getByText(/captcha|verify (?:you are human|your identity)|security challenge/i))) return { humanRequired: true };
    if (await visible(page.locator('[role="dialog"]:visible, .MuiModal-root:visible').filter({ hasText: /Login here|Get OTP/i }))) return { authRequired: true };
    const dialog = reviewDialog();
    if ((await dialog.count()) > 0 || onReviewPage()) {
      const root = (await dialog.count()) > 0 ? dialog.first() : page.locator("main, body").first();
      const empty = await root.locator('input:visible:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])').evaluateAll(
        (inputs) => inputs.filter((input) => !(input as HTMLInputElement).value.trim()).length
      );
      const salaryPrompt = await visible(root.getByText(/Please enter your annual salary/i));
      return { reviewStep: true, reviewNeedsInput: empty > 0 || salaryPrompt };
    }
    return null;
  }

  return {
    open: async (job) => {
      jobId = job.jobId ?? extractHiristJobId(job.jobUrl);
      await page.goto(job.jobUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    },
    isAuthenticated: () => isHiristAuthenticated(page),
    verifyIdentity: async (job) => {
      const currentId = extractHiristJobId(page.url());
      if (!jobId || !currentId || currentId !== jobId) return false;
      const expected = normalized(job.title);
      const visibleTitle = normalized((await page.locator("h1").first().textContent({ timeout: 15_000 }).catch(() => null)) ?? "");
      const documentTitle = normalized(await page.title());
      return Boolean(expected) && [visibleTitle, documentTitle].some((actual) => actual && (actual.includes(expected) || expected.includes(actual)));
    },
    detectType: async () => jobId ? classifyHiristJob(await client.jobDetail(jobId, { fresh: true })) : { applicationType: "UNKNOWN" },
    isAlreadyApplied: async () => visible(page.getByRole("button", { name: /^\s*Applied\s*$/i })),
    hasDirectApplyControl: async () => {
      const candidates = page.getByRole("button", { name: APPLY_BUTTON });
      await candidates.first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
      directApply = candidates.filter({ visible: true }).first();
      return (await directApply.count()) > 0;
    },
    clickDirectApplyOnce: async () => {
      if (!directApply) throw new Error("Direct Apply control was not verified.");
      await directApply.click();
    },
    inspectResult: async () => {
      const deadline = Date.now() + INSPECT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const signals = await readSignals().catch(() => null);
        if (signals) return signals;
        await page.waitForTimeout(500);
      }
      return { authRequired: !(await isHiristAuthenticated(page)) };
    },
    confirmReviewOnce: async () => {
      const dialog = reviewDialog();
      const inDialog = (await dialog.count()) > 0;
      const root = inDialog ? dialog.first() : page;
      const submit = root.getByRole("button", { name: inDialog ? REVIEW_SUBMIT_IN_DIALOG : REVIEW_SUBMIT_ON_PAGE }).filter({ visible: true });
      if ((await submit.count()) !== 1) return false;
      await submit.click();
      return true;
    },
  };
}

export async function applyToHiristJob(page: Page, job: DetailedJob, dryRun = true, onLiveApplyAttempt?: () => Promise<void>): Promise<ApplyResult> {
  return applyWithAdapter(createPlaywrightAdapter(page), job, dryRun, onLiveApplyAttempt);
}
