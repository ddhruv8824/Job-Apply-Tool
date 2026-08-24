export type QuestionnaireFieldType = "TEXT" | "TEXTAREA" | "NUMBER" | "RADIO" | "CHECKBOX" | "SELECT" | "BOOLEAN" | "UNKNOWN";

export type QuestionnaireQuestion = {
  id: string;
  text: string;
  fieldType: QuestionnaireFieldType;
  required: boolean;
  options?: string[];
  currentValue?: string;
  selectorInfo?: { controlId?: string; controlName?: string; containerTestId?: string };
};

export type AnswerSource = "CANDIDATE_PROFILE" | "APPLICATION_PROFILE" | "SAFE_DERIVATION" | "USER_INPUT" | "UNKNOWN";
export type AnswerStatus = "RESOLVED" | "NEEDS_INPUT" | "UNSUPPORTED";
export type ResolvedAnswer = { questionId: string; question: string; answer?: string; source: AnswerSource; confidence: number; status: AnswerStatus; evidence?: string };

export type QuestionCategory = "CURRENT_LOCATION" | "PREFERRED_LOCATION" | "TOTAL_EXPERIENCE" | "SKILL_EXPERIENCE" | "NOTICE_PERIOD" | "CURRENT_CTC" | "EXPECTED_CTC" | "RELOCATION" | "EMPLOYMENT_STATUS" | "WORK_AUTHORIZATION" | "EDUCATION" | "SKILL_KNOWLEDGE" | "YES_NO_GENERAL" | "FREE_TEXT" | "UNKNOWN";

export type QuestionnaireResult =
  | { status: "READY_FOR_REVIEW" }
  | { status: "NEEDS_INPUT"; unresolvedQuestions: QuestionnaireQuestion[] }
  | { status: "DRY_RUN"; questions: number; resolved: number; needsInput: number; unsupported: number }
  | { status: "SUBMITTED" }
  | { status: "APPLIED" }
  | { status: "AUTH_REQUIRED"; message?: string }
  | { status: "VALIDATION_FAILED"; message?: string }
  | { status: "UNKNOWN"; message?: string };

export const MAX_QUESTIONNAIRE_STEPS = 5;
