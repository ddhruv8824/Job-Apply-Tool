import type { Page } from "playwright";
import type { QuestionnaireFieldType, QuestionnaireQuestion } from "./types.js";

export type RawQuestionControl = {
  id?: string; name?: string; inputType?: string; tagName: string; text: string; required?: boolean;
  options?: string[]; currentValue?: string; containerTestId?: string;
};

export function mapRawQuestion(raw: RawQuestionControl, index: number): QuestionnaireQuestion {
  const tag = raw.tagName.toLowerCase(); const input = (raw.inputType ?? "").toLowerCase();
  let fieldType: QuestionnaireFieldType = "UNKNOWN";
  if (tag === "textarea") fieldType = "TEXTAREA";
  else if (tag === "select") fieldType = "SELECT";
  else if (tag === "input" && input === "number") fieldType = "NUMBER";
  else if (tag === "input" && ["text", "email", "tel", "url"].includes(input)) fieldType = "TEXT";
  else if (tag === "input" && input === "radio") fieldType = raw.options?.length === 2 && raw.options.every((item) => /^(?:yes|no)$/i.test(item.trim())) ? "BOOLEAN" : "RADIO";
  else if (tag === "input" && input === "checkbox") fieldType = "CHECKBOX";
  return {
    id: raw.id || raw.name || `question-${index + 1}`,
    text: raw.text.trim() || `Unlabelled question ${index + 1}`,
    fieldType, required: Boolean(raw.required),
    ...(raw.options?.length ? { options: [...new Set(raw.options.map((item) => item.trim()).filter(Boolean))] } : {}),
    ...(raw.currentValue ? { currentValue: raw.currentValue } : {}),
    selectorInfo: { ...(raw.id ? { controlId: raw.id } : {}), ...(raw.name ? { controlName: raw.name } : {}), ...(raw.containerTestId ? { containerTestId: raw.containerTestId } : {}) },
  };
}

/** Read-only DOM pass. It never clicks, focuses, fills, selects, or navigates. */
export async function extractQuestionnaire(page: Page): Promise<QuestionnaireQuestion[]> {
  const controlsSelector = 'input:not([type="hidden"]):visible, textarea:visible, select:visible, [role="radiogroup"] input[type="radio"]:visible';
  const dialogs = page.locator('[role="dialog"]:visible').filter({ has: page.locator(controlsSelector) });
  const forms = page.locator('form:visible').filter({ has: page.locator(controlsSelector), hasText: /question|answer|required|screening|experience|notice|location|salary|ctc/i });
  const root = (await dialogs.count()) === 1 ? dialogs : (await forms.count()) === 1 ? forms : undefined;
  if (!root) return [];
  const raw = await root.locator(controlsSelector).evaluateAll((controls) => {
    const seenRadioNames = new Set<string>();
    return controls.flatMap((node) => {
      const control = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (control instanceof HTMLInputElement && control.type === "radio" && control.name) {
        if (seenRadioNames.has(control.name)) return [];
        seenRadioNames.add(control.name);
      }
      const escapedId = control.id ? CSS.escape(control.id) : "";
      const explicitLabel = escapedId ? document.querySelector(`label[for="${escapedId}"]`)?.textContent : undefined;
      const container = control.closest('[data-testid], fieldset, [role="group"], .question, .form-group, li, div');
      const legend = container?.querySelector("legend")?.textContent;
      const nestedLabel = control.closest("label")?.textContent;
      const nearbyLabel = container?.querySelector("label")?.textContent;
      let options: string[] | undefined;
      if (control instanceof HTMLSelectElement) options = Array.from(control.options).filter((option) => !option.disabled && option.value !== "").map((option) => option.textContent?.trim() || option.value);
      if (control instanceof HTMLInputElement && control.type === "radio") {
        const radios = control.name ? document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(control.name)}"]`) : [control];
        options = Array.from(radios).map((radio) => {
          const label = radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`)?.textContent : radio.closest("label")?.textContent;
          return label?.trim() || radio.value;
        });
      }
      return [{ id: control.id, name: control.getAttribute("name") ?? undefined, inputType: control instanceof HTMLInputElement ? control.type : undefined,
        tagName: control.tagName, text: (legend || explicitLabel || nestedLabel || nearbyLabel || control.getAttribute("aria-label") || control.getAttribute("placeholder") || "").trim(),
        required: control.required || control.getAttribute("aria-required") === "true" || Boolean(container?.querySelector('[aria-required="true"], .required')),
        options, currentValue: control.value || undefined, containerTestId: container?.getAttribute("data-testid") ?? undefined }];
    });
  });
  return raw.map(mapRawQuestion);
}
