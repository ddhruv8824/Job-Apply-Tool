import { createHiristClient, pageTransport } from "./hirist/api.js";
import { connectToChrome } from "./hirist/browser.js";
import {
  ensureHiristAuthenticated,
} from "./hirist/auth.js";
import { resolveLocationIds } from "./hirist/locations.js";
import { searchJobsPage, type Job } from "./hirist/searchJobs.js";
import {
  getJobsDetails,
  type DetailedJob,
} from "./hirist/getJobDetails.js";

const searchConfig = {
  keyword: "Frontend Developer",
  location: "Pune",
  maxJobs: 10,
};

async function main() {
  console.log("Starting Job Agent...\n");

  console.log("Connecting to Chrome on port 9222...");
  const { page } = await connectToChrome();
  console.log("Connected.\n");

  console.log("Opening Hirist...");
  await ensureHiristAuthenticated(page);

  console.log("Searching Hirist...\n");
  const client = createHiristClient(pageTransport(page));
  const { jobs }: { jobs: Job[] } = await searchJobsPage(
    client,
    { keyword: searchConfig.keyword, locationIds: resolveLocationIds(searchConfig.location) },
    0
  );

  const jobsToDetail = jobs.slice(0, searchConfig.maxJobs);
  console.log(`Found ${jobsToDetail.length} jobs\n`);
  console.log("Extracting details...\n");

  const detailedJobs: DetailedJob[] = await getJobsDetails(client, jobsToDetail);

  console.log("Phase 2 Batch Summary\n");
  console.log(`Jobs attempted: ${jobsToDetail.length}`);
  console.log(`Successful: ${detailedJobs.length}`);
  console.log(`Failed: ${jobsToDetail.length - detailedJobs.length}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error("\nFailed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
);
