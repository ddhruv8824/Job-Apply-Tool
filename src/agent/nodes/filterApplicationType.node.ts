import { partitionJobsByApplicationType } from "../../naukri/applicationType.js";
import type { JobAgentState } from "../state.js";

export async function filterApplicationTypeNode(state: JobAgentState): Promise<Partial<JobAgentState>> {
  console.log("[filterApplicationType] Starting");
  const partitioned = partitionJobsByApplicationType(state.detailedJobs);
  console.log("[filterApplicationType]");
  console.log(`Direct: ${partitioned.directJobs.length}`);
  console.log(`External: ${partitioned.externalJobs.length}`);
  console.log(`Walk-in: ${partitioned.walkInJobs.length}`);
  console.log(`Unknown: ${partitioned.unknownJobs.length}`);
  if (partitioned.directJobs.length === 0) console.log("No Naukri Direct jobs found.\nSkipping AI matching.");
  return partitioned;
}
