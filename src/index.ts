import { connectToChrome } from "./naukri/browser.js";
import {
  ensureNaukriAuthenticated,
} from "./naukri/auth.js";
import { searchJobs, type Job } from "./naukri/searchJobs.js";
import {
  getJobsDetails,
  type DetailedJob,
} from "./naukri/getJobDetails.js";

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

  console.log("Opening Naukri...");
  await ensureNaukriAuthenticated(page);

  console.log("Searching Naukri...\n");
  const jobs: Job[] = await searchJobs(
    page,
    searchConfig.keyword,
    searchConfig.location,
    searchConfig.maxJobs
  );

  const jobsToDetail = jobs.slice(0, searchConfig.maxJobs);
  console.log(`Found ${jobsToDetail.length} jobs\n`);
  console.log("Extracting details...\n");

  const detailedJobs: DetailedJob[] = await getJobsDetails(page, jobsToDetail);

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
