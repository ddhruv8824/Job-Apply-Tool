import { connectToChrome } from "./browser.js";
import { loadEnvFile } from "node:process";
import { ensureNaukriAuthenticated } from "./auth.js";
import { discoverDirectJobs, type DiscoveryConfig } from "./discoverDirectJobs.js";

try { loadEnvFile(); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

const config: DiscoveryConfig = {
  keyword: process.env.JOB_KEYWORD?.trim() || "Frontend Developer",
  location: process.env.JOB_LOCATION?.trim() || "Pune",
  targetDirectJobs: positiveInteger("TARGET_DIRECT_JOBS", 10),
  maxJobsToInspect: positiveInteger("MAX_JOBS_TO_INSPECT", 60),
  maxPages: positiveInteger("MAX_SEARCH_PAGES", 5),
};

const { page } = await connectToChrome();
await ensureNaukriAuthenticated(page);
const result = await discoverDirectJobs(page, config);
console.log("\nDiscovery complete.\n");
console.log(`Inspected: ${result.inspectedJobs}`);
console.log(`Pages: ${result.pagesVisited}`);
console.log(`Direct: ${result.directCount}`);
console.log(`External: ${result.externalCount}`);
console.log(`Walk-in: ${result.walkInCount}`);
console.log(`Unknown: ${result.unknownCount}`);
console.log("Database persistence: DISABLED for discovery-only command (use npm run agent for tracked discovery)");
console.log("CandidateProfile/Groq called: NO");
process.exit(0);
