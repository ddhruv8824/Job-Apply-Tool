import type { Page } from "playwright";
import { locateQuestionControl } from "./questionControl.js";
import type { QuestionnaireQuestion, ResolvedAnswer } from "./types.js";

const normalize = (value: string): string => value.trim().toLowerCase();
export async function validateQuestionnaire(page: Page, questions: QuestionnaireQuestion[], answers: ResolvedAnswer[]): Promise<{ valid: boolean; message?: string }> {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  for (const question of questions) {
    const answer = byId.get(question.id); if (answer?.status !== "RESOLVED" || answer.answer === undefined) continue;
    const control = await locateQuestionControl(page, question); if (!control) return { valid: false, message: `Control disappeared: ${question.text}` };
    let actual: string;
    if (["RADIO", "BOOLEAN"].includes(question.fieldType)) {
      const checked = question.selectorInfo?.controlName
        ? page.locator(`[name="${question.selectorInfo.controlName.replace(/(["\\])/g, "\\$1")}"]:checked`)
        : page.getByLabel(answer.answer, { exact: true }).filter({ visible: true });
      if (await checked.count() !== 1) return { valid: false, message: `No unique checked option: ${question.text}` };
      actual = await checked.evaluate((node) => {
        const input = node as HTMLInputElement;
        const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent : input.closest("label")?.textContent;
        return label?.trim() || input.value;
      });
    } else if (question.fieldType === "CHECKBOX") actual = (await control.isChecked()) ? "yes" : "no";
    else if (question.fieldType === "SELECT") actual = await control.evaluate((node) => (node as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? "");
    else actual = await control.inputValue();
    if (normalize(actual) !== normalize(answer.answer)) return { valid: false, message: `Value mismatch for '${question.text}'.` };
  }
  return { valid: true };
}
