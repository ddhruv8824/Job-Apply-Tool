import type { DirectJobDiscoveryResult } from "../naukri/discoverDirectJobs.js";
import type { DetailedJob } from "../naukri/getJobDetails.js";
import type { Job } from "../naukri/searchJobs.js";
import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import type { MatchResult } from "../matching/match.schema.js";
import type { JobAgentDependencies } from "./dependencies.js";
import { createJobAgentGraph, initialJobAgentState } from "./graph.js";

function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
const profile: CandidateProfile = { targetRoles: [], skills: ["React"], workExperience: [], projects: [], education: [], certifications: [] };
function job(id: number): Job { return { title: `Job ${id}`, company: "Company", location: "Pune", jobUrl: `https://www.naukri.com/job-${id}` }; }
function detailed(value: Job): DetailedJob { return { ...value, description: "Description", applicationType: "NAUKRI_DIRECT" }; }
function match(id: number, score: number): MatchResult {
  return { title: `Job ${id}`, company: "Company", jobUrl: `https://www.naukri.com/${id}`, overallScore: score,
    skillMatchScore: score, experienceMatchScore: score, roleMatchScore: score, responsibilityMatchScore: score,
    skillMatches: [], unknownSkills: [], hardMissingRequirements: [], matchedSkills: [], missingRequiredSkills: [],
    missingPreferredSkills: [], matchedEvidence: [], strengths: [], concerns: [],
    recommendation: score >= 85 ? "APPLY" : score >= 70 ? "REVIEW" : "SKIP", reason: "test" };
}
function discovery(directJobs: Job[], manualCount = 0): DirectJobDiscoveryResult {
  return { directJobs, manualJobs: Array.from({ length: manualCount }, (_, index) => ({ ...job(100 + index), applicationType: "EXTERNAL_COMPANY" as const })),
    inspectedJobs: directJobs.length + manualCount, pagesVisited: 1, directCount: directJobs.length,
    externalCount: manualCount, walkInCount: 0, unknownCount: 0 };
}
function dependencies(overrides: Partial<JobAgentDependencies> = {}, calls: string[] = []): JobAgentDependencies {
  const direct = [job(1), job(2)];
  return {
    discoverDirectJobs: async () => { calls.push("discover"); return discovery(direct); },
    loadProfile: async () => { calls.push("profile"); return profile; },
    extractJobDetails: async (jobs) => { calls.push(`details:${jobs.length}`); return jobs.map(detailed); },
    matchJobs: async (_profile, jobs) => { calls.push(`match:${jobs.length}`); return jobs.map((item, index) => ({ ...match(index, index ? 91 : 75), jobId: item.jobId, jobUrl: item.jobUrl })); },
    persistDiscovery: async () => { calls.push("persist"); },
    filterPreviouslyApplied: async (jobs) => { calls.push(`history:${jobs.length}`); return { processableJobs: jobs, previouslyAppliedJobs: [] }; },
    saveMatchResults: async (matches) => { calls.push(`save:${matches.length}`); },
    ...overrides,
  };
}

const happyCalls: string[] = [];
const happy = await createJobAgentGraph(dependencies({}, happyCalls)).invoke(initialJobAgentState());
expect(happy.summary?.totalJobs === 2 && happy.selectedApplication?.match.overallScore === 91 && happyCalls.join(",") === "discover,persist,history:2,profile,details:2,match:2,save:2", "Happy path failed");

const zeroCalls: string[] = [];
const zero = await createJobAgentGraph(dependencies({ discoverDirectJobs: async () => { zeroCalls.push("discover"); return discovery([], 5); } }, zeroCalls)).invoke(initialJobAgentState());
expect(zero.summary?.totalJobs === 5 && !zeroCalls.some((call) => call === "profile" || call.startsWith("match")), "Zero-direct route called profile or Groq matcher");

for (const permanentStatus of ["APPLIED", "ALREADY_APPLIED"] as const) {
  const blockedCalls: string[] = [];
  const blocked = await createJobAgentGraph(dependencies({
    filterPreviouslyApplied: async (jobs) => { blockedCalls.push(`blocked:${permanentStatus}`); return { processableJobs: [], previouslyAppliedJobs: jobs }; },
  }, blockedCalls)).invoke(initialJobAgentState());
  expect(blocked.summary?.previouslyAppliedSkipped === 2, `${permanentStatus} skip count failed`);
  expect(!blockedCalls.some((call) => call === "profile" || call.startsWith("details") || call.startsWith("match")), `${permanentStatus} reached expensive work`);
}

let extractedCount = -1;
await createJobAgentGraph(dependencies({
  discoverDirectJobs: async () => discovery([job(1), job(2)], 3),
  extractJobDetails: async (jobs) => { extractedCount = jobs.length; return jobs.map(detailed); },
})).invoke(initialJobAgentState());
expect(extractedCount === 2, "Full extraction received non-direct jobs");

const partial = await createJobAgentGraph(dependencies({ extractJobDetails: async (jobs) => jobs.slice(0, 1).map(detailed) })).invoke(initialJobAgentState());
expect(partial.detailedJobs.length === 1 && partial.errors.some((error) => error.includes("1 job detail")), "Partial-detail route failed");

let profileFailed = false;
try { await createJobAgentGraph(dependencies({ loadProfile: async () => { throw new Error("profile unavailable"); } })).invoke(initialJobAgentState()); }
catch { profileFailed = true; }
expect(profileFailed, "Critical profile failure did not stop graph");

const ranking = await createJobAgentGraph(dependencies({ matchJobs: async () => [match(1, 75), match(2, 91), match(3, 62)] })).invoke(initialJobAgentState());
expect(ranking.rankedMatches.map((item) => item.overallScore).join(",") === "91,75,62", "Ranking failed");

console.log("Happy-path test: PASSED");
console.log("Zero-direct/no-Groq route: PASSED");
console.log("APPLIED/ALREADY_APPLIED pre-profile hard skip: PASSED");
console.log("Direct-only full extraction: PASSED");
console.log("Partial-detail route: PASSED");
console.log("Critical-profile failure: PASSED");
console.log("Ranking test: PASSED");
