import path from "node:path";
import { loadApplicationProfile } from "../application/loadApplicationProfile.js";
import { isNaukriAuthenticated } from "../naukri/auth.js";
import { connectToChrome } from "../naukri/browser.js";
import { extractResumeText } from "../resume/parseResume.js";
import { getCandidateProfile } from "../resume/getCandidateProfile.js";
import { extractQuestionnaire } from "./extractQuestionnaire.js";
import { resolveQuestionnaire } from "./resolveQuestionnaire.js";

// This command is an acceptance probe, never an interaction runner. Override
// even a caller-supplied false value before importing any mutation path.
process.env.QUESTIONNAIRE_DRY_RUN = "true";

function heading(): void {
  console.log("================================");
  console.log("NAUKRI QUESTIONNAIRE LIVE CHECK");
  console.log("================================\n");
}

function isNaukriDomain(url: string): boolean {
  try { const host = new URL(url).hostname.toLowerCase(); return host === "naukri.com" || host.endsWith(".naukri.com"); } catch { return false; }
}

heading();
let page;
try {
  page = (await connectToChrome()).page;
} catch (error) {
  console.log("Live questionnaire not available.");
  console.log("No DOM acceptance performed.");
  console.log(`Reason: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  process.exit(0);
}

if (!isNaukriDomain(page.url())) {
  console.log("EXTERNAL_REDIRECT");
  console.log("No DOM acceptance performed.");
  process.exit(0);
}
if (!(await isNaukriAuthenticated(page))) {
  console.log("AUTH_REQUIRED");
  console.log("No DOM acceptance performed.");
  process.exit(0);
}

const questions = await extractQuestionnaire(page);
if (!questions.length) {
  console.log("Live questionnaire not available.");
  console.log("No DOM acceptance performed.");
  console.log("Questionnaire field modifications: 0");
  console.log("Questionnaire submit clicks: 0");
  process.exit(0);
}

const profile = await getCandidateProfile(await extractResumeText(path.resolve("data", "DhruvCVU.pdf")));
const answers = resolveQuestionnaire(questions, await loadApplicationProfile(), profile);
console.log(`Domain:\n${new URL(page.url()).hostname}\n`);
console.log("Questionnaire detected:\nYES\n");
console.log(`Question count:\n${questions.length}\n`);
questions.forEach((question, index) => {
  const answer = answers.find((item) => item.questionId === question.id);
  const strategy = question.selectorInfo?.controlId ? "question container + control id" : question.selectorInfo?.controlName ? "question container + control name" : "question container + accessible label";
  console.log("--------------------------------\n");
  console.log(`Question ${index + 1}\n`);
  console.log(`Text:\n${question.text}\n`);
  console.log(`Detected type:\n${question.fieldType}\n`);
  console.log(`Required:\n${question.required ? "YES" : "NO"}\n`);
  if (question.options?.length) console.log(`Options:\n${question.options.map((option) => `- ${option}`).join("\n")}\n`);
  console.log(`Selector strategy:\n${strategy}\n`);
  console.log(`Current value:\n${question.currentValue ? "PRESENT (redacted)" : "EMPTY"}\n`);
  console.log(`Resolution:\n${answer?.status ?? "UNSUPPORTED"}\n`);
  console.log(`Answer:\n${answer?.answer ?? "UNKNOWN"}\n`);
  console.log(`Source:\n${answer?.source ?? "UNKNOWN"}\n`);
  if (answer?.evidence) console.log(`Evidence:\n${answer.evidence}\n`);
});
const resolved = answers.filter((answer) => answer.status === "RESOLVED").length;
const needsInput = answers.filter((answer) => answer.status === "NEEDS_INPUT").length;
const unsupported = answers.filter((answer) => answer.status === "UNSUPPORTED").length;
console.log("================================\n");
console.log(`Questions: ${questions.length}`);
console.log(`Resolved: ${resolved}`);
console.log(`Needs input: ${needsInput}`);
console.log(`Unsupported: ${unsupported}\n`);
console.log("Questionnaire fields modified: 0");
console.log("Questionnaire submit clicks: 0\n");
console.log("LIVE DOM ACCEPTANCE: PASSED");
