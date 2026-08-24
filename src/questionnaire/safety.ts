export function isQuestionnaireMutationAllowed(environment = process.env): boolean {
  return environment.QUESTIONNAIRE_DRY_RUN?.trim().toLowerCase() === "false";
}

export function assertQuestionnaireMutationAllowed(environment = process.env): void {
  if (!isQuestionnaireMutationAllowed(environment)) {
    throw new Error("Questionnaire mutation refused because QUESTIONNAIRE_DRY_RUN is enabled.");
  }
}
