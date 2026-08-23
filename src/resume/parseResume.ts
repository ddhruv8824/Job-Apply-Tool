import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

const MIN_RESUME_TEXT_LENGTH = 200;

function normalizeResumeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t\u00a0 ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractResumeText(filePath: string): Promise<string> {
  let data: Buffer;

  try {
    data = await readFile(filePath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new Error(`Resume file not found: ${filePath}`);
    }
    throw new Error(
      `Could not read resume PDF: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();
    const text = normalizeResumeText(result.text);

    if (text.length < MIN_RESUME_TEXT_LENGTH) {
      throw new Error(
        "Resume PDF did not contain enough extractable text. " +
          "It may be scanned or image-only."
      );
    }

    return text;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Resume PDF did not contain")
    ) {
      throw error;
    }
    throw new Error(
      `Could not extract resume text: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await parser.destroy();
  }
}
