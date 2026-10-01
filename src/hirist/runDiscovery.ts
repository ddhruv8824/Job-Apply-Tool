import { loadEnvFile } from "node:process";
import { createHiristClient, pageTransport } from "./api.js";
import { connectToChrome } from "./browser.js";
import { ensureHiristAuthenticated } from "./auth.js";
import { getDiscoveryConfig } from "./config.js";
import { discoverDirectJobs } from "./discoverDirectJobs.js";

try { loadEnvFile(); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const config = getDiscoveryConfig();
const { page } = await connectToChrome();
await ensureHiristAuthenticated(page);
const result = await discoverDirectJobs(createHiristClient(pageTransport(page)), config);
console.log("\nDiscovery complete.\n");
console.log(`Inspected: ${result.inspectedJobs}`);
console.log(`Pages: ${result.pagesVisited}`);
console.log(`Direct: ${result.directCount}`);
console.log(`External: ${result.externalCount}`);
console.log(`Walk-in: ${result.walkInCount}`);
console.log(`Unknown: ${result.unknownCount}`);
console.log("Database persistence: DISABLED for discovery-only command (use npm run agent for tracked discovery)");
console.log("CandidateProfile/LLM called: NO");
process.exit(0);
