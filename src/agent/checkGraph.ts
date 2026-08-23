import type { DetailedJob } from "../naukri/getJobDetails.js";
import type { Job } from "../naukri/searchJobs.js";
import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import type { MatchResult } from "../matching/match.schema.js";
import { classifyApplicationSignals, partitionJobsByApplicationType } from "../naukri/applicationType.js";
import type { JobAgentDependencies } from "./dependencies.js";
import { createJobAgentGraph, initialJobAgentState } from "./graph.js";

function expect(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
const profile: CandidateProfile = { targetRoles: [], skills: ["React"], workExperience: [], projects: [], education: [], certifications: [] };
const jobs: Job[] = [
  { title: "Job A", company: "A", location: "Pune", jobUrl: "https://www.naukri.com/a" },
  { title: "Job B", company: "B", location: "Pune", jobUrl: "https://www.naukri.com/b" },
];
const detailed: DetailedJob[] = jobs.map((job, index) => ({ ...job, description: `Description ${index}`, applicationType: "NAUKRI_DIRECT" }));
function match(index: number, score: number): MatchResult {
  return { title: `Job ${index}`, company: "Company", jobUrl: `https://www.naukri.com/${index}`,
    overallScore: score, skillMatchScore: score, experienceMatchScore: score, roleMatchScore: score,
    responsibilityMatchScore: score, skillMatches: [], unknownSkills: [], hardMissingRequirements: [],
    matchedSkills: [], missingRequiredSkills: [], missingPreferredSkills: [], matchedEvidence: [], strengths: [], concerns: [],
    recommendation: score >= 85 ? "APPLY" : score >= 70 ? "REVIEW" : "SKIP", reason: "test" };
}

function dependencies(overrides: Partial<JobAgentDependencies> = {}, calls: string[] = []): JobAgentDependencies {
  return {
    loadProfile: async () => { calls.push("profile"); return profile; },
    searchJobs: async () => { calls.push("search"); return jobs; },
    extractJobDetails: async () => { calls.push("details"); return detailed; },
    matchJobs: async () => { calls.push("match"); return [match(1, 75), match(2, 91)]; },
    ...overrides,
  };
}

const happyCalls: string[] = [];
const happy = await createJobAgentGraph(dependencies({}, happyCalls)).invoke(initialJobAgentState());
expect(happy.summary?.totalJobs === 2 && happyCalls.join(",") === "profile,search,details,match", "Happy path failed");

const partitionInput: DetailedJob[] = [
  ...detailed.map((job) => ({ ...job, applicationType: "NAUKRI_DIRECT" as const })),
  ...detailed.map((job) => ({ ...job, applicationType: "EXTERNAL_COMPANY" as const })),
  { ...detailed[0]!, applicationType: "UNKNOWN" },
  { ...detailed[0]!, applicationType: "WALK_IN" },
];
const partitioned = partitionJobsByApplicationType(partitionInput);
expect(partitioned.directJobs.length === 2 && partitioned.externalJobs.length === 2 && partitioned.unknownJobs.length === 1 && partitioned.walkInJobs.length === 1, "Application partition failed");
expect(classifyApplicationSignals({ directLabel: "Apply" }).applicationType === "NAUKRI_DIRECT", "Direct signal classification failed");
expect(classifyApplicationSignals({ externalLabel: "Apply on company site" }).applicationType === "EXTERNAL_COMPANY", "External signal classification failed");
expect(classifyApplicationSignals({ walkInLabel: "Walk-in" }).applicationType === "WALK_IN", "Walk-in signal classification failed");
expect(classifyApplicationSignals({}).applicationType === "UNKNOWN", "Unknown fallback failed");

let receivedByAi = -1;
const mixedDetails: DetailedJob[] = [
  { ...detailed[0]!, applicationType: "NAUKRI_DIRECT" },
  { ...detailed[1]!, applicationType: "NAUKRI_DIRECT" },
  { ...detailed[0]!, applicationType: "EXTERNAL_COMPANY" },
  { ...detailed[1]!, applicationType: "EXTERNAL_COMPANY" },
  { ...detailed[0]!, applicationType: "UNKNOWN" },
];
await createJobAgentGraph(dependencies({
  searchJobs: async () => mixedDetails,
  extractJobDetails: async () => mixedDetails,
  matchJobs: async (_profile, available) => { receivedByAi = available.length; return available.map((_job, index) => match(index, 75)); },
})).invoke(initialJobAgentState());
expect(receivedByAi === 2, "AI did not receive only direct jobs");

const zeroCalls: string[] = [];
const zero = await createJobAgentGraph(dependencies({ searchJobs: async () => { zeroCalls.push("search"); return []; } }, zeroCalls)).invoke(initialJobAgentState());
expect(zero.summary?.totalJobs === 0 && !zeroCalls.includes("details") && !zeroCalls.includes("match"), "Zero-job route failed");

const zeroDetailCalls: string[] = [];
const zeroDetails = await createJobAgentGraph(dependencies({
  extractJobDetails: async () => { zeroDetailCalls.push("details"); return []; },
  matchJobs: async () => { zeroDetailCalls.push("match"); return []; },
}, zeroDetailCalls)).invoke(initialJobAgentState());
expect(zeroDetails.summary?.analyzedJobs === 0 && !zeroDetailCalls.includes("match"), "Zero-detail route failed");

let zeroDirectMatched = false;
const manualOnly = detailed.map((job, index) => ({ ...job, applicationType: index === 0 ? "EXTERNAL_COMPANY" as const : "UNKNOWN" as const }));
const zeroDirect = await createJobAgentGraph(dependencies({
  extractJobDetails: async () => manualOnly,
  matchJobs: async () => { zeroDirectMatched = true; return []; },
})).invoke(initialJobAgentState());
expect(!zeroDirectMatched && zeroDirect.summary?.directJobs === 0 && zeroDirect.summary.externalJobs === 1, "Zero-direct route failed");

const partial = await createJobAgentGraph(dependencies({
  extractJobDetails: async () => detailed.slice(0, 1),
  matchJobs: async (_profile, available) => available.map((_job, index) => match(index, 75)),
})).invoke(initialJobAgentState());
expect(partial.detailedJobs.length === 1 && partial.matches.length === 1 && partial.errors.some((error) => error.includes("1 job detail")), "Partial detail route failed");

let profileFailed = false;
try {
  await createJobAgentGraph(dependencies({ loadProfile: async () => { throw new Error("profile unavailable"); } })).invoke(initialJobAgentState());
} catch { profileFailed = true; }
expect(profileFailed, "Critical profile failure did not stop graph");

const ranking = await createJobAgentGraph(dependencies({ matchJobs: async () => [match(1, 75), match(2, 91), match(3, 62)] })).invoke(initialJobAgentState());
expect(ranking.rankedMatches.map((item) => item.overallScore).join(",") === "91,75,62", "Ranking failed");

console.log("Happy-path test: PASSED");
console.log("Application partition test: PASSED");
console.log("Application signal classification test: PASSED");
console.log("Direct-only matching test: PASSED");
console.log("Zero-job route: PASSED");
console.log("Zero-detail route: PASSED");
console.log("Zero-direct route: PASSED");
console.log("Partial-detail route: PASSED");
console.log("Critical-profile failure: PASSED");
console.log("Ranking test: PASSED");
