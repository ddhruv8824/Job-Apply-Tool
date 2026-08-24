import type { Page } from "playwright";
import type { ApplicationProfile } from "../application/applicationProfile.schema.js";
import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import { isExplicitApproval } from "../application/approval.js";
import { isNaukriAuthenticated } from "../naukri/auth.js";
import { extractQuestionnaire } from "./extractQuestionnaire.js";
import { fillQuestionnaire } from "./fillQuestionnaire.js";
import { resolveQuestionnaire, withUserInput } from "./resolveQuestionnaire.js";
import { validateQuestionnaire } from "./validateQuestionnaire.js";
import { MAX_QUESTIONNAIRE_STEPS, type QuestionnaireQuestion, type QuestionnaireResult, type ResolvedAnswer } from "./types.js";
import { isQuestionnaireMutationAllowed } from "./safety.js";

export type QuestionnairePrompts = {
  input: (question: QuestionnaireQuestion) => Promise<string>;
  approve: (questions: QuestionnaireQuestion[], answers: ResolvedAnswer[], step: number) => Promise<string>;
  review?: (questions: QuestionnaireQuestion[], answers: ResolvedAnswer[], step: number) => void;
};

export type QuestionnaireRuntime = {
  url: () => string;
  authenticated: () => Promise<boolean>;
  challengeVisible: () => Promise<boolean>;
  applied: () => Promise<boolean>;
  extract: () => Promise<QuestionnaireQuestion[]>;
  fill: (questions: QuestionnaireQuestion[], answers: ResolvedAnswer[]) => Promise<void>;
  validate: (questions: QuestionnaireQuestion[], answers: ResolvedAnswer[]) => Promise<{ valid: boolean; message?: string }>;
  submitOnce: () => Promise<boolean>;
  settle: () => Promise<void>;
};

export function isQuestionnaireDryRun(environment = process.env): boolean {
  return !isQuestionnaireMutationAllowed(environment);
}

function isNaukriUrl(url: string): boolean {
  try { const host = new URL(url).hostname.toLowerCase(); return host === "naukri.com" || host.endsWith(".naukri.com"); } catch { return false; }
}

async function challengeVisible(page: Page): Promise<boolean> {
  const signal = page.getByText(/captcha|one[ -]?time password|\botp\b|phone verification|verify your (?:identity|phone)/i).first();
  return (await signal.count()) > 0 && await signal.isVisible().catch(() => false);
}

async function applicationApplied(page: Page): Promise<boolean> {
  const signal = page.getByText(/successfully applied|application sent|application submitted|^applied$/i).first();
  return (await signal.count()) > 0 && await signal.isVisible().catch(() => false);
}

async function findSubmissionControl(page: Page) {
  const control = page.getByRole("button", { name: /^(?:submit|continue|apply|send)$/i });
  const visible = control.filter({ visible: true });
  return (await visible.count()) === 1 ? visible : undefined;
}

export async function runQuestionnaire(options: { page: Page; candidateProfile: CandidateProfile; applicationProfile: ApplicationProfile; prompts: QuestionnairePrompts; dryRun?: boolean; maxSteps?: number; runtime?: QuestionnaireRuntime }): Promise<QuestionnaireResult> {
  const { page, candidateProfile, applicationProfile, prompts } = options;
  const dryRun = options.dryRun ?? isQuestionnaireDryRun();
  const maxSteps = options.maxSteps ?? MAX_QUESTIONNAIRE_STEPS;
  const runtime: QuestionnaireRuntime = options.runtime ?? {
    url: () => page.url(), authenticated: () => isNaukriAuthenticated(page), challengeVisible: () => challengeVisible(page),
    applied: () => applicationApplied(page), extract: () => extractQuestionnaire(page),
    fill: (questions, answers) => fillQuestionnaire(page, questions, answers), validate: (questions, answers) => validateQuestionnaire(page, questions, answers),
    submitOnce: async () => { const submit = await findSubmissionControl(page); if (!submit) return false; await submit.click(); return true; },
    settle: async () => { await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined); },
  };
  let totalQuestions = 0; let totalResolved = 0; let totalNeedsInput = 0; let totalUnsupported = 0;
  for (let step = 1; step <= maxSteps; step += 1) {
    if (!isNaukriUrl(runtime.url())) return { status: "UNKNOWN", message: "EXTERNAL_REDIRECT: questionnaire left Naukri." };
    if (await runtime.challengeVisible() || !(await runtime.authenticated())) return { status: "AUTH_REQUIRED", message: "Authentication, OTP, CAPTCHA, or human verification is required." };
    if (await runtime.applied()) return { status: "APPLIED" };
    const questions = await runtime.extract();
    if (!questions.length) return { status: "UNKNOWN", message: "No supported questionnaire controls were visible." };
    let answers = resolveQuestionnaire(questions, applicationProfile, candidateProfile);
    totalQuestions += questions.length;
    for (const question of questions) {
      const index = answers.findIndex((answer) => answer.questionId === question.id);
      const answer = answers[index];
      if (!answer || answer.status !== "NEEDS_INPUT" || !question.required) continue;
      const entered = await prompts.input(question);
      answers[index] = withUserInput(answer, entered);
    }
    totalResolved += answers.filter((answer) => answer.status === "RESOLVED").length;
    totalNeedsInput += answers.filter((answer) => answer.status === "NEEDS_INPUT").length;
    totalUnsupported += answers.filter((answer) => answer.status === "UNSUPPORTED").length;
    prompts.review?.(questions, answers, step);
    const unresolvedRequired = questions.filter((question) => question.required && answers.find((answer) => answer.questionId === question.id)?.status !== "RESOLVED");
    if (dryRun) return { status: "DRY_RUN", questions: totalQuestions, resolved: totalResolved, needsInput: totalNeedsInput, unsupported: totalUnsupported };
    if (unresolvedRequired.length) return { status: "NEEDS_INPUT", unresolvedQuestions: unresolvedRequired };
    if (!isExplicitApproval(await prompts.approve(questions, answers, step))) return { status: "READY_FOR_REVIEW" };
    await runtime.fill(questions, answers);
    const validation = await runtime.validate(questions, answers);
    if (!validation.valid) return { status: "VALIDATION_FAILED", message: validation.message };
    if (!(await runtime.submitOnce())) return { status: "UNKNOWN", message: "A unique verified questionnaire submission control was not found." };
    await runtime.settle();
    if (!isNaukriUrl(runtime.url())) return { status: "UNKNOWN", message: "EXTERNAL_REDIRECT: questionnaire left Naukri." };
    if (await runtime.applied()) return { status: "APPLIED" };
    if (await runtime.challengeVisible() || !(await runtime.authenticated())) return { status: "AUTH_REQUIRED" };
  }
  return { status: "UNKNOWN", message: `Questionnaire exceeded hard limit of ${maxSteps} steps.` };
}
