import { strict as assert } from "node:assert";
import type { ApplicationProfile } from "../application/applicationProfile.schema.js";
import { ApplicationProfileSchema } from "../application/applicationProfile.schema.js";
import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import { isQuestionnaireDryRun, runQuestionnaire, type QuestionnaireRuntime } from "./runQuestionnaire.js";
import type { Page } from "playwright";
import { assertQuestionnaireMutationAllowed, isQuestionnaireMutationAllowed } from "./safety.js";
import { mapRawQuestion } from "./extractQuestionnaire.js";
import { resolveAnswer } from "./resolveAnswer.js";
import { withUserInput } from "./resolveQuestionnaire.js";

const candidate: CandidateProfile = { totalExperienceYears: 5, targetRoles: [], skills: ["React"], workExperience: [], projects: [], education: [], certifications: [] };
const application: ApplicationProfile = { currentLocation: "Pune", noticePeriodDays: 30 };
assert.equal(ApplicationProfileSchema.safeParse(application).success, true);
assert.equal(ApplicationProfileSchema.safeParse({ noticePeriodDays: -1 }).success, false);
const text = mapRawQuestion({ id: "location", tagName: "input", inputType: "text", text: "Current location", required: true }, 0);
assert.equal(text.fieldType, "TEXT"); assert.equal(text.required, true);
const radio = mapRawQuestion({ name: "relocate", tagName: "input", inputType: "radio", text: "Willing to relocate?", options: ["Yes", "No"] }, 0);
assert.equal(radio.fieldType, "BOOLEAN"); assert.deepEqual(radio.options, ["Yes", "No"]);
const select = mapRawQuestion({ id: "notice", tagName: "select", text: "Notice period", options: ["Immediate", "15 days", "30 days", "60 days"] }, 0);
assert.equal(select.fieldType, "SELECT");
assert.equal(mapRawQuestion({ tagName: "button", text: "Custom picker" }, 0).fieldType, "UNKNOWN");
assert.deepEqual(resolveAnswer(text, application, candidate), { questionId: "location", question: "Current location", answer: "Pune", source: "APPLICATION_PROFILE", evidence: "Explicit currentLocation in ApplicationProfile.", confidence: 1, status: "RESOLVED" });
assert.equal(resolveAnswer({ ...text, id: "ctc", text: "Expected CTC" }, application, candidate).status, "NEEDS_INPUT");
assert.equal(resolveAnswer(select, application, candidate).answer, "30 days");
assert.equal(resolveAnswer({ ...text, id: "k8s", text: "How many years of Kubernetes experience do you have?", fieldType: "NUMBER" }, application, candidate).status, "NEEDS_INPUT");
const verifiedReact: CandidateProfile = { ...candidate, workExperience: [{ role: "Engineer", startDate: "2022", endDate: "2025", description: [], technologies: ["React"] }] };
const react = resolveAnswer({ ...text, id: "react", text: "How many years of React experience do you have?", fieldType: "NUMBER" }, application, verifiedReact);
assert.equal(react.status, "RESOLVED"); assert.equal(react.source, "SAFE_DERIVATION"); assert.ok(react.evidence);
const entered = withUserInput(resolveAnswer({ ...text, id: "np", text: "Notice period" }, {}, candidate), "30 days");
assert.equal(entered.source, "USER_INPUT"); assert.equal(entered.answer, "30 days");
assert.equal(isQuestionnaireDryRun({}), true); assert.equal(isQuestionnaireDryRun({ QUESTIONNAIRE_DRY_RUN: "false" }), false);
assert.equal(isQuestionnaireMutationAllowed({ QUESTIONNAIRE_DRY_RUN: "true" }), false);
assert.throws(() => assertQuestionnaireMutationAllowed({ QUESTIONNAIRE_DRY_RUN: "true" }), /mutation refused/i);
assert.doesNotThrow(() => assertQuestionnaireMutationAllowed({ QUESTIONNAIRE_DRY_RUN: "false" }));

const requiredLocation = { ...text, required: true };
function runtime(question = requiredLocation): { value: QuestionnaireRuntime; counts: { fills: number; submits: number }; setUrl: (value: string) => void; setValid: (value: boolean) => void; setApplied: (value: boolean) => void } {
  const counts = { fills: 0, submits: 0 }; let url = "https://www.naukri.com/job-123"; let valid = true; let applied = false;
  return { counts, setUrl: (value) => { url = value; }, setValid: (value) => { valid = value; }, setApplied: (value) => { applied = value; }, value: {
    url: () => url, authenticated: async () => true, challengeVisible: async () => false, applied: async () => applied,
    extract: async () => [question], fill: async () => { counts.fills += 1; }, validate: async () => valid ? { valid: true } : { valid: false, message: "mismatch" },
    submitOnce: async () => { counts.submits += 1; return true; }, settle: async () => undefined,
  } };
}
const fakePage = {} as Page;
const dry = runtime();
const dryResult = await runQuestionnaire({ page: fakePage, candidateProfile: candidate, applicationProfile: application, dryRun: true, runtime: dry.value,
  prompts: { input: async () => "", approve: async () => "yes" } });
assert.equal(dryResult.status, "DRY_RUN"); assert.deepEqual(dry.counts, { fills: 0, submits: 0 });
const unresolved = runtime({ ...text, id: "missing", text: "Expected CTC", required: true });
const unresolvedResult = await runQuestionnaire({ page: fakePage, candidateProfile: candidate, applicationProfile: application, dryRun: false, runtime: unresolved.value,
  prompts: { input: async () => "", approve: async () => "yes" } });
assert.equal(unresolvedResult.status, "NEEDS_INPUT"); assert.deepEqual(unresolved.counts, { fills: 0, submits: 0 });
const rejected = runtime();
assert.equal((await runQuestionnaire({ page: fakePage, candidateProfile: candidate, applicationProfile: application, dryRun: false, runtime: rejected.value,
  prompts: { input: async () => "", approve: async () => "no" } })).status, "READY_FOR_REVIEW");
assert.deepEqual(rejected.counts, { fills: 0, submits: 0 });
const mismatch = runtime(); mismatch.setValid(false);
assert.equal((await runQuestionnaire({ page: fakePage, candidateProfile: candidate, applicationProfile: application, dryRun: false, runtime: mismatch.value,
  prompts: { input: async () => "", approve: async () => "yes" } })).status, "VALIDATION_FAILED");
assert.deepEqual(mismatch.counts, { fills: 1, submits: 0 });
const redirected = runtime(); redirected.value.settle = async () => redirected.setUrl("https://example.com/ats");
const redirectResult = await runQuestionnaire({ page: fakePage, candidateProfile: candidate, applicationProfile: application, dryRun: false, runtime: redirected.value,
  prompts: { input: async () => "", approve: async () => "yes" } });
assert.equal(redirectResult.status, "UNKNOWN"); assert.match("message" in redirectResult ? redirectResult.message ?? "" : "", /EXTERNAL_REDIRECT/); assert.equal(redirected.counts.submits, 1);
const appliedRuntime = runtime(); appliedRuntime.value.settle = async () => appliedRuntime.setApplied(true);
assert.equal((await runQuestionnaire({ page: fakePage, candidateProfile: candidate, applicationProfile: application, dryRun: false, runtime: appliedRuntime.value,
  prompts: { input: async () => "", approve: async () => "yes" } })).status, "APPLIED"); assert.equal(appliedRuntime.counts.submits, 1);
const limited = runtime();
const limitedResult = await runQuestionnaire({ page: fakePage, candidateProfile: candidate, applicationProfile: application, dryRun: false, maxSteps: 2, runtime: limited.value,
  prompts: { input: async () => "", approve: async () => "yes" } });
assert.equal(limitedResult.status, "UNKNOWN"); assert.equal(limited.counts.submits, 2);
console.log("Questionnaire extraction mapping: PASSED");
console.log("Verified answer resolution: PASSED");
console.log("Missing CTC/skill experience -> NEEDS_INPUT: PASSED");
console.log("Notice option mapping: PASSED");
console.log("Safe skill derivation evidence: PASSED");
console.log("Session-only user input: PASSED");
console.log("QUESTIONNAIRE_DRY_RUN safe default: PASSED");
console.log("Dry run zero-interaction/unresolved/rejection gates: PASSED");
console.log("Defense-in-depth mutation refusal: PASSED");
console.log("DOM validation failure blocks submit: PASSED");
console.log("External redirect and applied detection: PASSED");
console.log("Single submit per step and hard step limit: PASSED");
