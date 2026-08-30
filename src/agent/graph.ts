import { END, START, StateGraph } from "@langchain/langgraph";
import type { JobAgentDependencies } from "./dependencies.js";
import { buildSummaryNode } from "./nodes/buildSummary.node.js";
import { createExtractDetailsNode } from "./nodes/extractDetails.node.js";
import { createDiscoverDirectJobsNode } from "./nodes/discoverDirectJobs.node.js";
import { createLoadProfileNode } from "./nodes/loadProfile.node.js";
import { createFilterPreviouslyAppliedNode } from "./nodes/filterPreviouslyApplied.node.js";
import { createMatchJobsNode } from "./nodes/matchJobs.node.js";
import { rankJobsNode } from "./nodes/rankJobs.node.js";
import { selectReadyToApplyNode } from "./nodes/selectReadyToApply.node.js";
import { JobAgentStateAnnotation, type JobAgentState } from "./state.js";

export const GRAPH_STRUCTURE =
  "START -> discoverDirectJobs -> (zero direct: buildSummary | filterPreviouslyApplied -> (zero processable: buildSummary | loadProfile -> extractJobDetails -> matchJobs -> rankJobs -> selectReadyToApply -> buildSummary)) -> END";

export function initialJobAgentState(): JobAgentState {
  return { profile: undefined, jobs: [], detailedJobs: [], directJobs: [], processableDirectJobs: [], previouslyAppliedJobs: [], historyStats: undefined, manualJobs: [], discovery: undefined, matches: [], rankedMatches: [], readyToApplyJobs: [], selectedApplication: undefined, applicationResult: undefined, summary: undefined, errors: [] };
}

export function createJobAgentGraph(dependencies: JobAgentDependencies) {
  return new StateGraph(JobAgentStateAnnotation)
    .addNode("discoverDirectJobs", createDiscoverDirectJobsNode(dependencies))
    .addNode("filterPreviouslyApplied", createFilterPreviouslyAppliedNode(dependencies))
    .addNode("loadProfile", createLoadProfileNode(dependencies))
    .addNode("extractJobDetails", createExtractDetailsNode(dependencies))
    .addNode("matchJobs", createMatchJobsNode(dependencies))
    .addNode("rankJobs", rankJobsNode)
    .addNode("selectReadyToApply", selectReadyToApplyNode)
    .addNode("buildSummary", buildSummaryNode)
    .addEdge(START, "discoverDirectJobs")
    .addConditionalEdges(
      "discoverDirectJobs",
      (state) => state.directJobs.length === 0 ? "buildSummary" : "filterPreviouslyApplied",
      ["buildSummary", "filterPreviouslyApplied"]
    )
    .addConditionalEdges(
      "filterPreviouslyApplied",
      (state) => state.processableDirectJobs.length === 0 ? "buildSummary" : "loadProfile",
      ["buildSummary", "loadProfile"]
    )
    .addEdge("loadProfile", "extractJobDetails")
    .addConditionalEdges(
      "extractJobDetails",
      (state) => state.detailedJobs.length === 0 ? "buildSummary" : "matchJobs",
      ["buildSummary", "matchJobs"]
    )
    .addEdge("matchJobs", "rankJobs")
    .addEdge("rankJobs", "selectReadyToApply")
    .addEdge("selectReadyToApply", "buildSummary")
    .addEdge("buildSummary", END)
    .compile();
}
