import type { DetailedJob } from "../naukri/getJobDetails.js";
import type { Job } from "../naukri/searchJobs.js";
import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import type { MatchResult } from "../matching/match.schema.js";
import type { DirectJobDiscoveryResult } from "../naukri/discoverDirectJobs.js";

export type JobAgentDependencies = {
  loadProfile: () => Promise<CandidateProfile>;
  discoverDirectJobs: () => Promise<DirectJobDiscoveryResult>;
  extractJobDetails: (jobs: Job[]) => Promise<DetailedJob[]>;
  matchJobs: (profile: CandidateProfile, jobs: DetailedJob[]) => Promise<MatchResult[]>;
  persistDiscovery: (result: DirectJobDiscoveryResult) => Promise<void>;
  filterPreviouslyApplied: (jobs: Job[]) => Promise<{ processableJobs: Job[]; previouslyAppliedJobs: Job[] }>;
  saveMatchResults: (matches: MatchResult[]) => Promise<void>;
};
