import { loadEnvFile } from "node:process";
import { z } from "zod";
import { callLlm } from "./llm.js";

try {
  loadEnvFile();
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const LlmHealthSchema = z.object({
  ok: z.literal(true),
});

function removeSurroundingJsonFence(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match?.[1]?.trim() ?? text.trim();
}

async function main(): Promise<void> {
  console.log("Checking Groq LLM connection...\n");

  const responseText = await callLlm([
    {
      role: "user",
      content:
        'Return ONLY valid JSON matching this exact structure: {"ok":true}. ' +
        "Do not include markdown or explanation.",
    },
  ]);
  console.log("Groq configuration: FOUND");
  console.log("Request: SUCCESS");

  let parsed: unknown;
  try {
    parsed = JSON.parse(removeSurroundingJsonFence(responseText));
  } catch {
    throw new Error("LLM returned invalid JSON.");
  }
  console.log("JSON parsing: PASSED");

  LlmHealthSchema.parse(parsed);
  console.log("Zod validation: PASSED\n");
  console.log("LLM gateway check: PASSED");
}

main().catch((error) => {
  if (error instanceof z.ZodError) {
    console.error("LLM response failed Zod validation:", error.issues);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
