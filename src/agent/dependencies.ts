import type { DetailedJob } from "../naukri/getJobDetails.js";
import type { Job } from "../naukri/searchJobs.js";
import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import type { MatchResult } from "../matching/match.schema.js";

export type JobAgentDependencies = {
  loadProfile: () => Promise<CandidateProfile>;
  searchJobs: () => Promise<Job[]>;
  extractJobDetails: (jobs: Job[]) => Promise<DetailedJob[]>;
  matchJobs: (profile: CandidateProfile, jobs: DetailedJob[]) => Promise<MatchResult[]>;
};
