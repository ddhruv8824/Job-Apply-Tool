import { END, START, StateGraph } from "@langchain/langgraph";
import type { JobAgentDependencies } from "./dependencies.js";
import { buildSummaryNode } from "./nodes/buildSummary.node.js";
import { createExtractDetailsNode } from "./nodes/extractDetails.node.js";
import { filterApplicationTypeNode } from "./nodes/filterApplicationType.node.js";
import { createLoadProfileNode } from "./nodes/loadProfile.node.js";
import { createMatchJobsNode } from "./nodes/matchJobs.node.js";
import { rankJobsNode } from "./nodes/rankJobs.node.js";
import { createSearchJobsNode } from "./nodes/searchJobs.node.js";
import { JobAgentStateAnnotation, type JobAgentState } from "./state.js";

export const GRAPH_STRUCTURE =
  "START -> loadProfile -> searchJobs -> extractJobDetails -> filterApplicationType -> (zero direct: buildSummary | matchJobs -> rankJobs) -> buildSummary -> END";

export function initialJobAgentState(): JobAgentState {
  return { profile: undefined, jobs: [], detailedJobs: [], directJobs: [], externalJobs: [], walkInJobs: [], unknownJobs: [], matches: [], rankedMatches: [], summary: undefined, errors: [] };
}

export function createJobAgentGraph(dependencies: JobAgentDependencies) {
  return new StateGraph(JobAgentStateAnnotation)
    .addNode("loadProfile", createLoadProfileNode(dependencies))
    .addNode("searchJobs", createSearchJobsNode(dependencies))
    .addNode("extractJobDetails", createExtractDetailsNode(dependencies))
    .addNode("filterApplicationType", filterApplicationTypeNode)
    .addNode("matchJobs", createMatchJobsNode(dependencies))
    .addNode("rankJobs", rankJobsNode)
    .addNode("buildSummary", buildSummaryNode)
    .addEdge(START, "loadProfile")
    .addEdge("loadProfile", "searchJobs")
    .addConditionalEdges(
      "searchJobs",
      (state) => state.jobs.length === 0 ? "buildSummary" : "extractJobDetails",
      ["buildSummary", "extractJobDetails"]
    )
    .addConditionalEdges(
      "extractJobDetails",
      (state) => state.detailedJobs.length === 0 ? "buildSummary" : "filterApplicationType",
      ["buildSummary", "filterApplicationType"]
    )
    .addConditionalEdges(
      "filterApplicationType",
      (state) => state.directJobs.length === 0 ? "buildSummary" : "matchJobs",
      ["buildSummary", "matchJobs"]
    )
    .addEdge("matchJobs", "rankJobs")
    .addEdge("rankJobs", "buildSummary")
    .addEdge("buildSummary", END)
    .compile();
}
