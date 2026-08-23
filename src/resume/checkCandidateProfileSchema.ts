import {
  CandidateProfileSchema,
  type CandidateProfile,
} from "./candidateProfile.schema.js";

const validCandidate: CandidateProfile = {
  name: "Test User",
  currentRole: "Software Engineer",
  totalExperienceYears: 4,
  targetRoles: ["Frontend Developer"],
  skills: ["TypeScript", "React"],
  workExperience: [
    {
      company: "Example Company",
      role: "Software Engineer",
      description: ["Built frontend applications"],
      technologies: ["React", "TypeScript"],
    },
  ],
  projects: [],
  education: [],
  certifications: [],
};

CandidateProfileSchema.parse(validCandidate);
console.log("Valid-object test: PASSED");

const negativeExperience = CandidateProfileSchema.safeParse({
  totalExperienceYears: -5,
});
if (negativeExperience.success) {
  throw new Error("Negative experience was incorrectly accepted.");
}
console.log("Negative-experience test: REJECTED as expected");

const wrongSkillsType = CandidateProfileSchema.safeParse({
  skills: "React",
});
if (wrongSkillsType.success) {
  throw new Error("A string skills value was incorrectly accepted.");
}
console.log("Wrong-skills-type test: REJECTED as expected");

console.log("CandidateProfile schema verification: PASSED");
