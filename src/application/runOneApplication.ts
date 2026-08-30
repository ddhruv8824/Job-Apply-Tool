import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadEnvFile } from "node:process";
import { applyToNaukriJob } from "../naukri/applyToJob.js";
import { createJobAgentGraph, initialJobAgentState } from "../agent/graph.js";
import { createProductionDependencies } from "../agent/productionDependencies.js";
import { isDryRun, type ApplyResult, type ReadyToApplyJob } from "./application.js";
import { isExplicitApproval, runApplicationGate } from "./approval.js";
import { loadApplicationProfile } from "./loadApplicationProfile.js";
import { runQuestionnaire, isQuestionnaireDryRun } from "../questionnaire/runQuestionnaire.js";
import type { QuestionnaireQuestion, ResolvedAnswer } from "../questionnaire/types.js";
import { hasAlreadyApplied, recordApplicationAttempt, saveApplicationFailure, saveApplyResult, saveQuestionnaireResult } from "../db/applicationRepository.js";
import { sanitizeOperationalError } from "../db/sanitize.js";

try { loadEnvFile(); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

function printReady(eligible: ReadyToApplyJob[], selected: ReadyToApplyJob): void {
  console.log("\n================================");
  console.log("READY TO APPLY");
  console.log("================================\n");
  console.log(`Eligible jobs: ${eligible.length}\n`);
  eligible.forEach((item, index) => console.log(`${index + 1}. ${item.job.title} - ${item.job.company} - ${item.match.overallScore}%`));
  console.log(`\nPhase 6 will test only:\n${selected.job.title} - ${selected.job.company} - ${selected.match.overallScore}%`);
  console.log(`Recommendation: ${selected.match.recommendation}`);
  console.log(`Application Type: ${selected.job.applicationType}`);
  console.log(`Matched Skills: ${selected.match.matchedSkills.join(", ") || "None"}`);
  console.log(`Missing Required: ${selected.match.missingRequiredSkills.join(", ") || "None"}`);
  console.log(`Naukri URL: ${selected.job.jobUrl}\n`);
}

const dependencies = createProductionDependencies();
const result = await createJobAgentGraph(dependencies).invoke(initialJobAgentState());
const selected = result.selectedApplication;
if (!selected) {
  console.log("No Naukri Direct APPLY candidates found.");
  process.exit(0);
}
printReady(result.readyToApplyJobs, selected);

const dryRun = isDryRun();
let approval: string | undefined;
if (!dryRun) {
  console.log("This will click the Naukri Apply button once.");
  const terminal = createInterface({ input, output });
  approval = await terminal.question("Proceed? (yes/no): ");
  terminal.close();
  if (!isExplicitApproval(approval)) console.log("Application cancelled.");
} else {
  console.log("APPLY_DRY_RUN=true (safe default). The Apply button will only be verified.");
}

const page = await dependencies.getAuthenticatedPage();
let applicationResult: ApplyResult | null | undefined;
try {
  applicationResult = await runApplicationGate({
    dryRun,
    approval,
    verifyDryRun: () => applyToNaukriJob(page, selected.job, true),
    applyLive: async () => {
      if (await hasAlreadyApplied(selected.job)) return { status: "ALREADY_APPLIED", message: "Persistent history blocks a duplicate application." };
      return applyToNaukriJob(page, selected.job, false, () => recordApplicationAttempt(selected.job).then(() => undefined));
    },
  });
  if (applicationResult) await saveApplyResult(selected.job, applicationResult);
} catch (error) {
  await saveApplicationFailure(selected.job, error).catch((trackingError) => {
    console.error(`Could not persist application failure: ${sanitizeOperationalError(trackingError)}`);
  });
  throw error;
}
if (!applicationResult) process.exit(0);

console.log("\n================================");
console.log("APPLICATION RESULT");
console.log("================================\n");
console.log(`Job: ${selected.job.title} - ${selected.job.company}`);
console.log(`Match Score: ${selected.match.overallScore}%`);
console.log(`Application Type: ${selected.job.applicationType}`);
console.log(`Result: ${applicationResult.status}`);
if (applicationResult.message) console.log(applicationResult.message);
if (applicationResult.visibleQuestions !== undefined) console.log(`Visible questionnaire controls: ${applicationResult.visibleQuestions}`);
console.log("No additional application actions were performed.");
if (applicationResult.status === "QUESTIONNAIRE") {
  if (!result.profile) throw new Error("Candidate profile is unavailable for questionnaire resolution.");
  const applicationProfile = await loadApplicationProfile();
  const questionnaireDryRun = isQuestionnaireDryRun();
  const questionnaireTerminal = createInterface({ input, output });
  const printReview = (questions: QuestionnaireQuestion[], answers: ResolvedAnswer[], step: number): void => {
    console.log("\n================================");
    console.log("FINAL QUESTIONNAIRE REVIEW");
    console.log("================================\n");
    console.log(`Job: ${selected.job.title} - ${selected.job.company}`);
    console.log(`Step: ${step}\n`);
    questions.forEach((question, index) => {
      const answer = answers.find((item) => item.questionId === question.id);
      console.log(`${index + 1}. ${question.text}`);
      console.log(`   Answer: ${answer?.answer ?? "UNKNOWN"}`);
      console.log(`   Source: ${answer?.source ?? "UNKNOWN"}`);
      console.log(`   Status: ${answer?.status ?? "NEEDS_INPUT"}`);
      if (answer?.evidence) console.log(`   Evidence: ${answer.evidence}`);
    });
    const required = questions.filter((question) => question.required);
    const resolved = required.filter((question) => answers.find((answer) => answer.questionId === question.id)?.status === "RESOLVED");
    console.log(`\nRequired questions resolved: ${resolved.length}/${required.length}`);
    console.log("No answers have been submitted yet.");
  };
  const questionnaireResult = await runQuestionnaire({
    page, candidateProfile: result.profile, applicationProfile, dryRun: questionnaireDryRun,
    prompts: {
      input: async (question) => {
        console.log("\n================================"); console.log("QUESTIONNAIRE NEEDS INPUT"); console.log("================================\n");
        console.log(`Job: ${selected.job.title} - ${selected.job.company}`); console.log(`Question: ${question.text}`); console.log("Known answer: UNKNOWN");
        return questionnaireTerminal.question("Please enter answer (leave blank to keep unresolved): ");
      },
      review: printReview,
      approve: async () => questionnaireTerminal.question("Proceed with filling and submitting this questionnaire step? (yes/no): "),
    },
  }).catch(async (error) => {
    await saveApplicationFailure(selected.job, error).catch(() => undefined);
    throw error;
  }).finally(() => questionnaireTerminal.close());
  await saveQuestionnaireResult(selected.job, {
    status: questionnaireResult.status,
    message: "message" in questionnaireResult ? questionnaireResult.message : undefined,
  });
  console.log("\n================================"); console.log("QUESTIONNAIRE RESULT"); console.log("================================\n");
  console.log(`Result: ${questionnaireResult.status}`);
  if ("message" in questionnaireResult && questionnaireResult.message) console.log(questionnaireResult.message);
  if (questionnaireResult.status === "DRY_RUN") {
    console.log(`Questions detected: ${questionnaireResult.questions}`); console.log(`Resolved: ${questionnaireResult.resolved}`);
    console.log(`Needs input: ${questionnaireResult.needsInput}`); console.log(`Unsupported: ${questionnaireResult.unsupported}`);
    console.log("No questionnaire fields were modified."); console.log("No submission was performed.");
  }
}
process.exit(0);
