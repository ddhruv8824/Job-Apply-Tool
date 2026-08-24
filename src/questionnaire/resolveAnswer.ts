import type { ApplicationProfile } from "../application/applicationProfile.schema.js";
import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import { classifyQuestion } from "./classifyQuestion.js";
import type { QuestionnaireQuestion, ResolvedAnswer } from "./types.js";

const unknown = (question: QuestionnaireQuestion, unsupported = false): ResolvedAnswer => ({
  questionId: question.id, question: question.text, source: "UNKNOWN", confidence: 0,
  status: unsupported ? "UNSUPPORTED" : "NEEDS_INPUT",
});
const resolved = (question: QuestionnaireQuestion, answer: string, source: ResolvedAnswer["source"], evidence: string, confidence = 1): ResolvedAnswer => ({
  questionId: question.id, question: question.text, answer, source, evidence, confidence, status: "RESOLVED",
});
const normalized = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function matchOption(answer: string, options?: string[]): string | undefined {
  if (!options?.length) return answer;
  const exact = options.find((option) => normalized(option) === normalized(answer));
  if (exact) return exact;
  const days = answer.match(/^(\d+)\s*days?$/i)?.[1];
  if (days) return options.find((option) => new RegExp(`^\\s*${days}\\s*days?\\s*$`, "i").test(option));
  return undefined;
}

function booleanAnswer(question: QuestionnaireQuestion, value: boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  const options = question.options ?? [];
  const wanted = value ? "yes" : "no";
  return options.length ? options.find((option) => normalized(option) === wanted) : (value ? "Yes" : "No");
}

function skillFromQuestion(text: string, profile: CandidateProfile): string | undefined {
  const haystack = normalized(text);
  return profile.skills.find((skill) => haystack.includes(normalized(skill)));
}

function parseYear(value?: string): number | undefined {
  if (!value) return undefined;
  const year = Number(value.match(/\b(?:19|20)\d{2}\b/)?.[0]);
  return Number.isFinite(year) ? year : undefined;
}

function deriveSkillYears(question: QuestionnaireQuestion, profile: CandidateProfile, now = new Date()): ResolvedAnswer | undefined {
  const skill = skillFromQuestion(question.text, profile);
  if (!skill) return undefined;
  const intervals: Array<{ start: number; end: number; role: string }> = [];
  for (const work of profile.workExperience) {
    if (!work.technologies.some((technology) => normalized(technology) === normalized(skill))) continue;
    const start = parseYear(work.startDate); const end = /present|current/i.test(work.endDate ?? "") ? now.getFullYear() : parseYear(work.endDate);
    if (start === undefined || end === undefined || end < start) return undefined;
    intervals.push({ start, end, role: work.role });
  }
  if (!intervals.length) return undefined;
  const merged = intervals.map(({ start, end }) => ({ start, end })).sort((left, right) => left.start - right.start)
    .reduce<Array<{ start: number; end: number }>>((result, item) => {
      const last = result.at(-1);
      if (last && item.start <= last.end) last.end = Math.max(last.end, item.end); else result.push({ ...item });
      return result;
    }, []);
  const years = merged.reduce((sum, item) => sum + item.end - item.start, 0);
  if (years <= 0) return undefined;
  const answer = matchOption(String(years), question.options) ?? matchOption(`${years} years`, question.options);
  if (!answer) return undefined;
  return resolved(question, answer, "SAFE_DERIVATION", `${skill} explicitly listed for verified role(s): ${intervals.map((item) => item.role).join(", ")}; dated employment intervals total ${years} years.`, 0.9);
}

export function resolveAnswer(question: QuestionnaireQuestion, application: ApplicationProfile, candidate: CandidateProfile): ResolvedAnswer {
  if (question.fieldType === "UNKNOWN") return unknown(question, true);
  const category = classifyQuestion(question.text);
  let raw: string | undefined; let evidence = ""; let source: ResolvedAnswer["source"] = "APPLICATION_PROFILE";
  switch (category) {
    case "CURRENT_LOCATION": raw = application.currentLocation; evidence = "Explicit currentLocation in ApplicationProfile."; break;
    case "PREFERRED_LOCATION": raw = application.preferredLocations?.join(", "); evidence = "Explicit preferredLocations in ApplicationProfile."; break;
    case "NOTICE_PERIOD": raw = application.noticePeriodDays === undefined ? application.joiningAvailability : `${application.noticePeriodDays} days`; evidence = application.noticePeriodDays === undefined ? "Explicit joiningAvailability in ApplicationProfile." : "Explicit noticePeriodDays in ApplicationProfile."; break;
    case "CURRENT_CTC": raw = application.currentCtc?.toString(); evidence = "Explicit currentCtc in ApplicationProfile."; break;
    case "EXPECTED_CTC": raw = application.expectedCtc?.toString(); evidence = "Explicit expectedCtc in ApplicationProfile."; break;
    case "RELOCATION": raw = booleanAnswer(question, application.willingToRelocate); evidence = "Explicit willingToRelocate in ApplicationProfile."; break;
    case "EMPLOYMENT_STATUS": raw = booleanAnswer(question, application.currentlyEmployed); evidence = "Explicit currentlyEmployed in ApplicationProfile."; break;
    case "WORK_AUTHORIZATION": raw = application.workAuthorization; evidence = "Explicit workAuthorization in ApplicationProfile."; break;
    case "TOTAL_EXPERIENCE": {
      const years = application.totalExperienceYears ?? candidate.totalExperienceYears;
      raw = years?.toString(); source = application.totalExperienceYears === undefined ? "CANDIDATE_PROFILE" : "APPLICATION_PROFILE";
      evidence = `Explicit totalExperienceYears in ${source === "APPLICATION_PROFILE" ? "ApplicationProfile" : "CandidateProfile"}.`; break;
    }
    case "SKILL_EXPERIENCE": return deriveSkillYears(question, candidate) ?? unknown(question);
    default: return unknown(question);
  }
  if (raw === undefined) return unknown(question);
  const answer = matchOption(raw, question.options);
  return answer === undefined ? unknown(question) : resolved(question, answer, source, evidence);
}
