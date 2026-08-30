import { prisma } from "./prisma.js";
import { getRecentAgentRuns } from "./runRepository.js";

try {
  const runs = await getRecentAgentRuns();
  console.log("================================\nRECENT AGENT RUNS\n================================\n");
  if (!runs.length) console.log("None");
  for (const run of runs) {
    console.log(run.startedAt.toISOString());
    console.log(run.runType);
    console.log(run.status);
    console.log(`Inspected: ${run.jobsInspected}`);
    console.log(`Direct: ${run.directJobs}`);
    console.log(`Matched: ${run.matchedJobs}`);
    console.log(`Ready: ${run.readyToApplyJobs}`);
    if (run.error) console.log(`Reason: ${run.error}`);
    console.log();
  }
} finally {
  await prisma.$disconnect();
}
