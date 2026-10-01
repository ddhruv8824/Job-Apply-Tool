import type { DetailedJob } from "../hirist/getJobDetails.js";
import type { Job } from "../hirist/searchJobs.js";
import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import type { MatchResult } from "../matching/match.schema.js";
import type { DirectJobDiscoveryResult } from "../hirist/discoverDirectJobs.js";

export type JobAgentDependencies = {
  loadProfile: () => Promise<CandidateProfile>;
  discoverDirectJobs: () => Promise<DirectJobDiscoveryResult>;
  extractJobDetails: (jobs: Job[]) => Promise<DetailedJob[]>;
  matchJobs: (profile: CandidateProfile, jobs: DetailedJob[]) => Promise<MatchResult[]>;
  persistDiscovery: (result: DirectJobDiscoveryResult) => Promise<void>;
  filterPreviouslyApplied: (jobs: Job[]) => Promise<{ processableJobs: Job[]; previouslyAppliedJobs: Job[] }>;
  saveMatchResults: (matches: MatchResult[]) => Promise<void>;
};
