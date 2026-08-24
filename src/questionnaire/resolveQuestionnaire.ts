import type { ApplicationProfile } from "../application/applicationProfile.schema.js";
import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import { resolveAnswer } from "./resolveAnswer.js";
import type { QuestionnaireQuestion, ResolvedAnswer } from "./types.js";

export function resolveQuestionnaire(questions: QuestionnaireQuestion[], application: ApplicationProfile, candidate: CandidateProfile): ResolvedAnswer[] {
  return questions.map((question) => resolveAnswer(question, application, candidate));
}

export function withUserInput(answer: ResolvedAnswer, value: string): ResolvedAnswer {
  const clean = value.trim();
  return clean ? { ...answer, answer: clean, source: "USER_INPUT", confidence: 1, status: "RESOLVED", evidence: "Provided explicitly for this run only." } : answer;
}
