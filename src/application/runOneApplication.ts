import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadEnvFile } from "node:process";
import { applyToNaukriJob } from "../naukri/applyToJob.js";
import { createJobAgentGraph, initialJobAgentState } from "../agent/graph.js";
import { createProductionDependencies } from "../agent/productionDependencies.js";
import { isDryRun, type ApplyResult, type ReadyToApplyJob } from "./application.js";
import { isExplicitApproval, runApplicationGate } from "./approval.js";

try { loadEnvFile(); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

function printReady(eligible: ReadyToApplyJob[], selected: ReadyToApplyJob): void {
  console.log("\n================================");
  console.log("READY TO APPLY");
  console.log("================================\n");
  console.log(`Eligible jobs: ${eligible.length}\n`);
  eligible.forEach((item, index) => console.log(`${index + 1}. ${item.job.title} - ${item.job.company} - ${item.match.overallScore}%`));
  console.log(`\nPhase 6 will test only:\n${selected.job.title} - ${selected.job.company} - ${selected.match.overallScore}%`);
  console.log(`Recommendation: ${selected.match.recommendation}`);
  console.log(`Application Type: ${selected.job.applicationType}`);
  console.log(`Matched Skills: ${selected.match.matchedSkills.join(", ") || "None"}`);
  console.log(`Missing Required: ${selected.match.missingRequiredSkills.join(", ") || "None"}`);
  console.log(`Naukri URL: ${selected.job.jobUrl}\n`);
}

const dependencies = createProductionDependencies();
const result = await createJobAgentGraph(dependencies).invoke(initialJobAgentState());
const selected = result.selectedApplication;
if (!selected) {
  console.log("No Naukri Direct APPLY candidates found.");
  process.exit(0);
}
printReady(result.readyToApplyJobs, selected);

const dryRun = isDryRun();
let approval: string | undefined;
if (!dryRun) {
  console.log("This will click the Naukri Apply button once.");
  const terminal = createInterface({ input, output });
  approval = await terminal.question("Proceed? (yes/no): ");
  terminal.close();
  if (!isExplicitApproval(approval)) console.log("Application cancelled.");
} else {
  console.log("APPLY_DRY_RUN=true (safe default). The Apply button will only be verified.");
}

const page = await dependencies.getAuthenticatedPage();
const applicationResult = await runApplicationGate({
  dryRun,
  approval,
  verifyDryRun: () => applyToNaukriJob(page, selected.job, true),
  applyLive: () => applyToNaukriJob(page, selected.job, false),
});
if (!applicationResult) process.exit(0);

console.log("\n================================");
console.log("APPLICATION RESULT");
console.log("================================\n");
console.log(`Job: ${selected.job.title} - ${selected.job.company}`);
console.log(`Match Score: ${selected.match.overallScore}%`);
console.log(`Application Type: ${selected.job.applicationType}`);
console.log(`Result: ${applicationResult.status}`);
if (applicationResult.message) console.log(applicationResult.message);
if (applicationResult.visibleQuestions !== undefined) console.log(`Visible questionnaire controls: ${applicationResult.visibleQuestions}`);
console.log("No additional application actions were performed.");
process.exit(0);
