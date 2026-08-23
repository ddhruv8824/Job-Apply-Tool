import { loadEnvFile } from "node:process";
import { createJobAgentGraph, GRAPH_STRUCTURE, initialJobAgentState } from "./graph.js";
import { createProductionDependencies } from "./productionDependencies.js";

try { loadEnvFile(); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

async function main(): Promise<void> {
  console.log("Starting Job Agent Graph...\n");
  console.log(`Graph: ${GRAPH_STRUCTURE}\n`);
  const graph = createJobAgentGraph(createProductionDependencies());
  const result = await graph.invoke(initialJobAgentState());

  console.log("\n================================");
  console.log("TOP MATCHES");
  console.log("================================\n");
  result.rankedMatches.forEach((match, index) => {
    console.log(`${index + 1}. ${match.title} - ${match.company}`);
    console.log(`   Score: ${match.overallScore}%`);
    console.log(`   Recommendation: ${match.recommendation}`);
    console.log(`   URL: ${match.jobUrl}\n`);
  });
  const manualJobs = [...result.externalJobs, ...result.walkInJobs, ...result.unknownJobs];
  console.log("================================");
  console.log("MANUAL OPPORTUNITIES");
  console.log("================================\n");
  if (!manualJobs.length) console.log("None\n");
  manualJobs.forEach((job, index) => {
    console.log(`${index + 1}. ${job.title} - ${job.company}`);
    console.log(`   Type: ${job.applicationType}`);
    console.log(`   URL: ${job.jobUrl}\n`);
  });
  const summary = result.summary;
  console.log("================================");
  console.log("JOB PIPELINE SUMMARY");
  console.log("================================\n");
  console.log(`Jobs discovered: ${summary?.totalJobs ?? 0}`);
  console.log(`Naukri Direct: ${summary?.directJobs ?? 0}`);
  console.log(`External Company: ${summary?.externalJobs ?? 0}`);
  console.log(`Walk-in: ${summary?.walkInJobs ?? 0}`);
  console.log(`Unknown: ${summary?.unknownJobs ?? 0}`);
  console.log(`AI analyzed: ${summary?.analyzedJobs ?? 0}`);
  console.log(`APPLY: ${summary?.apply ?? 0}`);
  console.log(`REVIEW: ${summary?.review ?? 0}`);
  console.log(`SKIP: ${summary?.skip ?? 0}`);
  console.log(`Highest: ${summary?.highestScore ?? 0}%`);
  console.log(`Average: ${summary?.averageScore ?? 0}%`);
  if (result.errors.length) console.log(`Recoverable errors: ${result.errors.join("; ")}`);
}

main().then(() => process.exit(0), (error) => {
  console.error(`Job Agent Graph failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
