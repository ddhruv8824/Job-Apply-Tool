import type { Page } from "playwright";
import { locateQuestionControl } from "./questionControl.js";
import type { QuestionnaireQuestion, ResolvedAnswer } from "./types.js";
import { assertQuestionnaireMutationAllowed } from "./safety.js";

export async function fillQuestionnaire(page: Page, questions: QuestionnaireQuestion[], answers: ResolvedAnswer[]): Promise<void> {
  assertQuestionnaireMutationAllowed();
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  const unresolvedRequired = questions.filter((question) => question.required && byId.get(question.id)?.status !== "RESOLVED");
  if (unresolvedRequired.length) throw new Error(`Required questionnaire questions remain unresolved: ${unresolvedRequired.map((item) => item.text).join("; ")}`);
  for (const question of questions) {
    const answer = byId.get(question.id);
    if (answer?.status !== "RESOLVED" || answer.answer === undefined) continue;
    const control = await locateQuestionControl(page, question);
    if (!control) throw new Error(`Could not uniquely locate questionnaire control: ${question.text}`);
    if (["TEXT", "TEXTAREA", "NUMBER"].includes(question.fieldType)) await control.fill(answer.answer);
    else if (question.fieldType === "SELECT") await control.selectOption({ label: answer.answer });
    else if (["RADIO", "BOOLEAN"].includes(question.fieldType)) {
      const option = control.filter({ has: page.locator(`[value="${answer.answer.replace(/(["\\])/g, "\\$1")}"]`) });
      if (await option.count() === 1) await option.check();
      else {
        const labelled = page.getByLabel(answer.answer, { exact: true });
        if (await labelled.count() !== 1) throw new Error(`Could not uniquely locate option '${answer.answer}'.`);
        await labelled.check();
      }
    } else if (question.fieldType === "CHECKBOX") {
      if (!/^(?:yes|no|true|false)$/i.test(answer.answer)) throw new Error(`Checkbox answer is not an explicit boolean: ${question.text}`);
      await control.setChecked(/^(?:yes|true)$/i.test(answer.answer));
    } else throw new Error(`Automatic interaction is unsupported for: ${question.text}`);
  }
}
