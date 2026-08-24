import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadApplicationProfile } from "../application/loadApplicationProfile.js";
import { isNaukriAuthenticated } from "../naukri/auth.js";
import { connectToChrome } from "../naukri/browser.js";
import { extractResumeText } from "../resume/parseResume.js";
import { getCandidateProfile } from "../resume/getCandidateProfile.js";
import { runQuestionnaire } from "./runQuestionnaire.js";

const session = await connectToChrome();
if (!(await isNaukriAuthenticated(session.page))) throw new Error("The current Naukri tab is not authenticated. Log in manually and retry.");
const terminal = createInterface({ input, output });
try {
  const candidateProfile = await getCandidateProfile(await extractResumeText(path.resolve("data", "DhruvCVU.pdf")));
  const result = await runQuestionnaire({ page: session.page, candidateProfile, applicationProfile: await loadApplicationProfile(), dryRun: true,
    prompts: {
      input: async (question) => terminal.question(`Unknown required answer for '${question.text}' (leave blank to keep unresolved): `),
      approve: async () => "no",
      review: (questions, answers) => {
        console.log("\nQUESTIONNAIRE DRY RUN\n");
        questions.forEach((question, index) => {
          const answer = answers.find((item) => item.questionId === question.id);
          console.log(`${index + 1}. ${question.text}`); console.log(`   Answer: ${answer?.answer ?? "UNKNOWN"}`); console.log(`   Source: ${answer?.source ?? "UNKNOWN"}`); console.log(`   Status: ${answer?.status ?? "NEEDS_INPUT"}`);
        });
      },
    } });
  console.log(`\nResult: ${result.status}`);
  if (result.status === "DRY_RUN") console.log(`Questions detected: ${result.questions}\nResolved: ${result.resolved}\nNeeds input: ${result.needsInput}\nUnsupported: ${result.unsupported}`);
  console.log("No questionnaire fields were modified.\nNo submission was performed.");
} finally { terminal.close(); }
