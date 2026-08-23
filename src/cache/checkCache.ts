import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DetailedJob } from "../naukri/getJobDetails.js";
import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import type { JobMatchAnalysis } from "../matching/match.schema.js";
import { loadCandidateProfileCache, saveCandidateProfileCache } from "./candidateProfileCache.js";
import { loadJobAnalysisCache, saveJobAnalysisCache } from "./jobAnalysisCache.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const root = path.resolve(".cache");
await rm(root, { recursive: true, force: true });

const profile: CandidateProfile = {
  name: "Cache Test", targetRoles: [], skills: ["React"], workExperience: [], projects: [], education: [], certifications: [],
};
expect(await loadCandidateProfileCache("resume-a") === null, "Candidate first read must miss");
await saveCandidateProfileCache("resume-a", profile);
expect((await loadCandidateProfileCache("resume-a"))?.name === "Cache Test", "Candidate second read must hit");
expect(await loadCandidateProfileCache("resume-b") === null, "Changed resume must invalidate cache");
await writeFile(path.join(root, "candidate-profile.json"), "{broken", "utf8");
expect(await loadCandidateProfileCache("resume-a") === null, "Corrupt candidate cache must miss");

const job: DetailedJob = {
  title: "Frontend Developer", company: "Test Company", location: "Pune", jobUrl: "https://www.naukri.com/test",
  description: "React is required.", jobId: "cache-test-job", applicationType: "NAUKRI_DIRECT",
};
const analysis: JobMatchAnalysis = {
  requirements: [{ name: "React", importance: "REQUIRED", category: "CORE_TECHNICAL", importanceConfidence: 0.99, mandatoryEvidence: "React is required" }],
  responsibilities: [], experienceMatchScore: 80, roleMatchScore: 90, responsibilityMatchScore: 80,
  matchedEvidence: [], strengths: [], concerns: [], reason: "Cache test",
};
expect(await loadJobAnalysisCache(job) === null, "Job first read must miss");
await saveJobAnalysisCache(job, analysis);
expect((await loadJobAnalysisCache(job))?.requirements[0]?.name === "React", "Job second read must hit");
expect(await loadJobAnalysisCache({ ...job, description: "Changed JD" }) === null, "Changed JD must invalidate cache");
await mkdir(path.join(root, "job-analysis"), { recursive: true });
await writeFile(path.join(root, "job-analysis", "cache-test-job.json"), JSON.stringify({ jobId: "cache-test-job", jobHash: "invalid", analysis: {} }), "utf8");
expect(await loadJobAnalysisCache(job) === null, "Invalid job cache must miss");

await rm(root, { recursive: true, force: true });
console.log("Candidate cache MISS/HIT: PASSED");
console.log("Job analysis cache MISS/HIT: PASSED");
console.log("Cache invalidation: PASSED");
console.log("Cache corruption fallback: PASSED");
console.log("Zod cache validation: PASSED");
