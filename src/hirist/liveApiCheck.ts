import { loadEnvFile } from "node:process";
import { createHiristClient, nodeTransport } from "./api.js";
import { getDiscoveryConfig } from "./config.js";
import { discoverDirectJobs } from "./discoverDirectJobs.js";
import { getJobsDetails } from "./getJobDetails.js";

// Read-only acceptance probe against the public Hirist API. It needs no
// Chrome, login, database, or LLM, and never opens or applies to a job.
try { loadEnvFile(); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const config = { ...getDiscoveryConfig(), targetDirectJobs: 3, maxJobsToInspect: 10, maxPages: 2 };
const client = createHiristClient(nodeTransport);
const discovery = await discoverDirectJobs(client, config);
if (discovery.inspectedJobs === 0) throw new Error("Live search returned no jobs; check JOB_KEYWORD/JOB_LOCATION or the Hirist API.");
const detailed = await getJobsDetails(client, discovery.directJobs);
if (discovery.directJobs.length && !detailed.length) throw new Error("No job details could be extracted from the live API.");

console.log("\n================================");
console.log("HIRIST LIVE API CHECK");
console.log("================================\n");
console.log(`Pages: ${discovery.pagesVisited}  Inspected: ${discovery.inspectedJobs}  Direct: ${discovery.directCount}  External: ${discovery.externalCount}  Unknown: ${discovery.unknownCount}`);
for (const job of detailed) {
  console.log(`\n${job.title}\n  ${job.company} | ${job.location} | ${job.experience ?? "?"}`);
  console.log(`  ${job.jobUrl}`);
  console.log(`  Mandatory: ${job.mandatorySkills?.join(", ") || "None"}`);
  console.log(`  Description: ${job.description.length} chars | Screening: ${job.screeningRequired ? "YES" : "NO"}`);
}
console.log("\nApply clicks: 0");
console.log("LIVE API CHECK: PASSED");
