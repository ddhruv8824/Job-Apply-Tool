import path from "node:path";
import { loadEnvFile } from "node:process";
import { getCandidateProfile } from "./getCandidateProfile.js";
import { extractResumeText } from "./parseResume.js";

try {
  loadEnvFile();
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const resumePath = path.resolve("data", "DhruvCVU.pdf");

async function main(): Promise<void> {
  console.log("Building Candidate Profile...\n");
  const resumeText = await extractResumeText(resumePath);
  console.log("Resume: FOUND");
  console.log(`Resume text: ${resumeText.length} characters\n`);

  const profile = await getCandidateProfile(resumeText);

  console.log("\nCandidate Profile");
  console.log("=================\n");
  console.log(`Name: ${profile.name ?? "Not specified"}`);
  console.log(`Current Role: ${profile.currentRole ?? "Not specified"}`);
  console.log(
    `Experience: ${profile.totalExperienceYears ?? "Not explicitly specified"}`
  );
  console.log(`\nSkills (${profile.skills.length})`);
  for (const skill of profile.skills) console.log(`- ${skill}`);

  console.log(`\nWork Experience: ${profile.workExperience.length}`);
  profile.workExperience.forEach((entry, index) => {
    console.log(
      `${index + 1}. ${entry.role}${entry.company ? ` — ${entry.company}` : ""}`
    );
    console.log(
      `   Technologies: ${entry.technologies.join(", ") || "Not specified"}`
    );
  });
  console.log(`\nProjects: ${profile.projects.length}`);
  console.log(`Education: ${profile.education.length}`);
  console.log(`Certifications: ${profile.certifications.length}`);
  console.log("\nCandidateProfile created successfully.\n");
  console.log(JSON.stringify(profile, null, 2));
}

main().catch((error) => {
  console.error(
    `Failed to generate candidate profile: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
