import type { Locator, Page } from "playwright";
import type { QuestionnaireQuestion } from "./types.js";

function escaped(value: string): string { return value.replace(/(["\\])/g, "\\$1"); }

export async function locateQuestionControl(page: Page, question: QuestionnaireQuestion): Promise<Locator | undefined> {
  const info = question.selectorInfo;
  if (info?.controlId) {
    const byId = page.locator(`[id="${escaped(info.controlId)}"]`);
    if (await byId.count() === 1) return byId;
  }
  if (info?.controlName) {
    const byName = page.locator(`[name="${escaped(info.controlName)}"]`);
    if (question.fieldType === "RADIO" || question.fieldType === "BOOLEAN") return byName;
    if (await byName.count() === 1) return byName;
  }
  const byLabel = page.getByLabel(question.text, { exact: true });
  if (await byLabel.count() === 1) return byLabel;
  return undefined;
}
