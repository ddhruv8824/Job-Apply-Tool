import { Annotation } from "@langchain/langgraph";
import type { DetailedJob } from "../naukri/getJobDetails.js";
import type { Job } from "../naukri/searchJobs.js";
import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import type { MatchResult } from "../matching/match.schema.js";
import type { DirectJobDiscoveryResult, ManualJob } from "../naukri/discoverDirectJobs.js";
import type { ApplyResult, ReadyToApplyJob } from "../application/application.js";

export type JobAgentSummary = {
  totalJobs: number;
  directJobs: number;
  externalJobs: number;
  walkInJobs: number;
  unknownJobs: number;
  analyzedJobs: number;
  apply: number;
  review: number;
  skip: number;
  highestScore?: number;
  averageScore?: number;
};

const replaceArray = <T>() => Annotation<T[]>({ reducer: (_left, right) => right, default: () => [] });

export const JobAgentStateAnnotation = Annotation.Root({
  profile: Annotation<CandidateProfile | undefined>(),
  jobs: replaceArray<Job>(),
  detailedJobs: replaceArray<DetailedJob>(),
  directJobs: replaceArray<Job>(),
  manualJobs: replaceArray<ManualJob>(),
  discovery: Annotation<Omit<DirectJobDiscoveryResult, "directJobs" | "manualJobs"> | undefined>(),
  matches: replaceArray<MatchResult>(),
  rankedMatches: replaceArray<MatchResult>(),
  readyToApplyJobs: replaceArray<ReadyToApplyJob>(),
  selectedApplication: Annotation<ReadyToApplyJob | undefined>(),
  applicationResult: Annotation<ApplyResult | undefined>(),
  summary: Annotation<JobAgentSummary | undefined>(),
  errors: Annotation<string[]>({ reducer: (left, right) => left.concat(right), default: () => [] }),
});

export type JobAgentState = typeof JobAgentStateAnnotation.State;
