import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import { buildCandidateCapabilities, resolveCapability } from "./capabilities.js";
import { calculateMatchScore } from "./calculateMatchScore.js";
import type { JobMatchAnalysis, JobRequirement } from "./match.schema.js";

function profile(skills: string[]): CandidateProfile {
  return { targetRoles: [], skills, workExperience: [], projects: [], education: [], certifications: [] };
}
function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function capability(skills: string[], requirement: string) {
  return resolveCapability(buildCandidateCapabilities(profile(skills)), requirement);
}

const react = capability(["React"], "React");
expect(react.status === "EXPLICIT" && react.confidence === 1, "Test 1: React must be explicit");
const javascript = capability(["React", "Next.js"], "JavaScript");
expect(javascript.status === "STRONG_INFERENCE" && javascript.confidence >= 0.9, "Test 2: JavaScript inference failed");
expect(capability(["React"], "Redux").status === "UNKNOWN", "Test 3: Redux must remain unknown");
expect(capability(["Jenkins"], "CI CD").status === "STRONG_INFERENCE", "Test 4: Jenkins must infer CI/CD");
expect(capability(["AWS"], "Kubernetes").status === "UNKNOWN", "Test 5: AWS must not infer Kubernetes");
expect(capability(["React"], "Angular").status === "UNKNOWN", "Test 6: React must not infer Angular");

function analysis(requirement: JobRequirement): JobMatchAnalysis {
  return { requirements: [requirement], responsibilities: [], experienceMatchScore: 90, roleMatchScore: 90,
    responsibilityMatchScore: 90, matchedEvidence: [], strengths: [], concerns: [], reason: "test" };
}
const preferredRedux = calculateMatchScore(profile(["React"]), analysis({
  name: "Redux", importance: "PREFERRED", category: "SECONDARY_TECHNICAL", importanceConfidence: 0.9,
}));
const requiredJava = calculateMatchScore(profile(["React"]), analysis({
  name: "Java", importance: "REQUIRED", category: "CORE_TECHNICAL", importanceConfidence: 0.99,
  mandatoryEvidence: "Java is mandatory",
}));
expect(requiredJava.overallScore < preferredRedux.overallScore && requiredJava.hardMissingRequirements.includes("Java"),
  "Test 7: required Java must penalize more than preferred Redux");

console.log("Capability tests 1-7: PASSED");
console.log(`Preferred Redux score: ${preferredRedux.overallScore}`);
console.log(`Required Java score: ${requiredJava.overallScore}`);
console.log("Unsafe inference guards: PASSED");
