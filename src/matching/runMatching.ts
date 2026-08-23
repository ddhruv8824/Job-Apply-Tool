import path from "node:path";
import { loadEnvFile } from "node:process";
import { connectToChrome } from "../naukri/browser.js";
import { ensureNaukriAuthenticated } from "../naukri/auth.js";
import { getJobsDetails } from "../naukri/getJobDetails.js";
import { discoverDirectJobs, type DiscoveryConfig } from "../naukri/discoverDirectJobs.js";
import { getCandidateProfile } from "../resume/getCandidateProfile.js";
import { extractResumeText } from "../resume/parseResume.js";
import { matchJobs } from "./matchJobs.js";
import type { MatchResult } from "./match.schema.js";

try {
  loadEnvFile();
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}
const resumePath = path.resolve("data", "DhruvCVU.pdf");
const discoveryConfig: DiscoveryConfig = {
  keyword: process.env.JOB_KEYWORD?.trim() || "Frontend Developer",
  location: process.env.JOB_LOCATION?.trim() || "Pune",
  targetDirectJobs: positiveInteger("TARGET_DIRECT_JOBS", 10),
  maxJobsToInspect: positiveInteger("MAX_JOBS_TO_INSPECT", 60),
  maxPages: positiveInteger("MAX_SEARCH_PAGES", 5),
};

function printRanked(matches: MatchResult[]): void {
  console.log("\n================================");
  console.log("TOP MATCHES");
  console.log("================================\n");

  matches.forEach((match, index) => {
    console.log(`${index + 1}. ${match.title} — ${match.company}`);
    console.log(`   Score: ${match.overallScore}%`);
    console.log(`   Recommendation: ${match.recommendation}`);
    console.log(`   URL: ${match.jobUrl}\n`);
    console.log("   Matched:");
    const supported = match.skillMatches.filter(
      (item) => item.capabilityStatus !== "UNKNOWN" && item.capabilityStatus !== "CONTRADICTED"
    );
    if (!supported.length) console.log("   None");
    for (const item of supported) {
      console.log(`   ${item.skill}`);
      console.log(`     ${item.capabilityStatus.replace("_", " ")} - ${Math.round(item.confidence * 100)}%`);
      if (item.derivedFrom?.length) console.log(`     Derived from: ${item.derivedFrom.join(", ")}`);
    }
    console.log(`   Unknown: ${match.unknownSkills.join(", ") || "None"}`);
    console.log(`   Hard Missing: ${match.hardMissingRequirements.join(", ") || "None"}`);
    console.log("   Strengths:");
    for (const strength of match.strengths) console.log(`   - ${strength}`);
    console.log("--------------------------------\n");
  });
}

async function main(): Promise<void> {
  console.log("Connecting to Chrome on port 9222...");
  const { page } = await connectToChrome();
  console.log("Connected.\n");
  await ensureNaukriAuthenticated(page);

  const discovery = await discoverDirectJobs(page, discoveryConfig);
  console.log(`Direct jobs discovered: ${discovery.directCount}`);
  console.log(`Manual opportunities: ${discovery.manualJobs.length}\n`);
  if (discovery.directJobs.length === 0) {
    console.log("No direct jobs found. Skipping CandidateProfile and AI matching.");
    return;
  }

  console.log("Building candidate profile...");
  const profile = await getCandidateProfile(await extractResumeText(resumePath));
  console.log("Profile: READY\n");
  const detailedJobs = await getJobsDetails(page, discovery.directJobs);
  console.log(`Detailed jobs: ${detailedJobs.length}\n`);
  console.log("Analyzing matches...\n");
  const matches = await matchJobs(profile, detailedJobs);

  printRanked(matches);

  const counts = { APPLY: 0, REVIEW: 0, SKIP: 0 };
  for (const match of matches) counts[match.recommendation] += 1;
  const scores = matches.map((match) => match.overallScore);
  const average =
    scores.length > 0
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : 0;

  console.log("Phase 4 Summary\n");
  console.log(`Jobs analyzed: ${matches.length}`);
  console.log(`Failed analyses: ${detailedJobs.length - matches.length}`);
  console.log(`APPLY: ${counts.APPLY}`);
  console.log(`REVIEW: ${counts.REVIEW}`);
  console.log(`SKIP: ${counts.SKIP}`);
  console.log(`Highest match: ${scores[0] ?? 0}%`);
  console.log(`Average match: ${average}%`);
  console.log(`Lowest match: ${scores.at(-1) ?? 0}%`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(
      `Matching aborted: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
);
