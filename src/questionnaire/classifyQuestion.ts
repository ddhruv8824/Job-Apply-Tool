import type { QuestionCategory } from "./types.js";

const patterns: Array<[QuestionCategory, RegExp]> = [
  ["CURRENT_LOCATION", /\b(current|present)\s+(location|city)\b/i],
  ["PREFERRED_LOCATION", /\b(preferred|desired)\s+(location|city)\b/i],
  ["NOTICE_PERIOD", /\bnotice\s*period\b|how soon can you join|joining availability/i],
  ["CURRENT_CTC", /\b(current|present)\s+(ctc|salary|compensation)\b/i],
  ["EXPECTED_CTC", /\b(expected|desired)\s+(ctc|salary|compensation)\b/i],
  ["RELOCATION", /\brelocat(?:e|ion|ing)\b/i],
  ["WORK_AUTHORIZATION", /work\s+authori[sz]ation|authori[sz]ed to work|visa sponsorship/i],
  ["EMPLOYMENT_STATUS", /currently employed|employment status/i],
  ["TOTAL_EXPERIENCE", /total\s+(years?\s+of\s+)?experience|overall experience/i],
  ["SKILL_EXPERIENCE", /how many\s+(?:years?|months?).*experience|(?:years?|months?)\s+(?:of\s+)?(?:experience|working)|how long.*(?:used|worked)/i],
  ["EDUCATION", /degree|education|university|college|graduat/i],
];

export function classifyQuestion(text: string): QuestionCategory {
  for (const [category, pattern] of patterns) if (pattern.test(text)) return category;
  return "UNKNOWN";
}
