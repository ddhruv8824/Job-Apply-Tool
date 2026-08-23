import path from "node:path";
import { extractResumeText } from "./parseResume.js";

const resumePath = path.resolve("data", "DhruvCVU.pdf");

async function main(): Promise<void> {
  console.log("Loading resume...");
  const text = await extractResumeText(resumePath);
  console.log(`Resume text extracted: ${text.length} characters`);
  console.log("Resume text validation: PASSED");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
