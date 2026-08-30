import { z } from "zod";
import { callLlm } from "../ai/llm.js";
import { loadJobAnalysisCache, saveJobAnalysisCache } from "../cache/jobAnalysisCache.js";
import type { DetailedJob } from "../naukri/getJobDetails.js";
import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import {
  JobMatchAnalysisSchema,
  type JobMatchAnalysis,
} from "./match.schema.js";

const SYSTEM_PROMPT = `You are a conservative job-requirement classifier and job-to-candidate semantic analyst.

STRICT RULES:
1. CandidateProfile is the only source of truth about the candidate.
2. Never invent candidate skills, experience, projects, companies, technologies, certifications, or achievements.
3. Extract each actual JD requirement and classify its importance and category. Do not decide skill matches; TypeScript does that.
4. REQUIRED requires explicit JD language such as must have, mandatory, required, minimum, must possess, or essential. Include the exact supporting phrase in mandatoryEvidence. A Naukri Key Skills list alone is UNKNOWN, never automatically REQUIRED.
5. PREFERRED requires language such as preferred, nice to have, desirable, or good to have. Otherwise use UNKNOWN.
6. Alternatives such as "React or Angular" are not independently mandatory unless the text explicitly requires each one.
7. Classify generic/soft requirements separately so they cannot dominate technical fit.
   Requirement names MUST be atomic capabilities, never full sentences or combined lists.
   Example: "proficiency in HTML, CSS and JavaScript" becomes three requirements named "HTML", "CSS", and "JavaScript".
   Keep duties such as "build responsive pages" in responsibilities; do not duplicate whole duty sentences as skill requirements.
8. Use actual candidate work/project evidence and copy evidence faithfully.
9. Do not exaggerate fit or experience. Do not make an APPLY/REVIEW/SKIP decision.
10. Return only valid JSON matching the required structure, with no markdown.`;

const RESPONSE_SHAPE = `{
  "requirements": [{
    "name": string,
    "importance": "REQUIRED" | "PREFERRED" | "UNKNOWN",
    "category": "CORE_TECHNICAL" | "SECONDARY_TECHNICAL" | "TOOL" | "DOMAIN" | "SOFT_SKILL" | "GENERIC",
    "importanceConfidence": number 0-1,
    "mandatoryEvidence"?: string
  }],
  "requiredExperienceYears"?: number,
  "preferredExperienceYears"?: number,
  "responsibilities": string[],
  "roleType"?: string,
  "seniority"?: string,
  "experienceMatchScore": number 0-100,
  "roleMatchScore": number 0-100,
  "responsibilityMatchScore": number 0-100,
  "matchedEvidence": string[],
  "strengths": string[],
  "concerns": string[],
  "reason": string
}`;

function removeJsonFence(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match?.[1]?.trim() ?? text.trim();
}

function relevantJob(job: DetailedJob): Record<string, unknown> {
  return {
    title: job.title,
    company: job.company,
    location: job.location,
    experience: job.experience,
    description: job.description,
    skills: job.skills,
    role: job.role,
    industry: job.industry,
    employmentType: job.employmentType,
    education: job.education,
  };
}

export async function analyzeJobMatch(
  profile: CandidateProfile,
  job: DetailedJob
): Promise<JobMatchAnalysis> {
  const label = job.jobId ?? job.title;
  const cached = await loadJobAnalysisCache(job);
  if (cached) {
    console.log(`Job ${label} analysis cache: HIT`);
    return cached;
  }
  console.log(`Job ${label} analysis cache: MISS`);
  let previousError: Error | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const correction = previousError
        ? `\nPrevious response was invalid: ${previousError.message}. Return corrected JSON only.`
        : "";
      const response = await callLlm([
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Required JSON structure:\n${RESPONSE_SHAPE}\n\n` +
            `CANDIDATE PROFILE:\n${JSON.stringify(profile)}\n\n` +
            `JOB:\n${JSON.stringify(relevantJob(job))}${correction}`,
        },
      ]);

      let parsed: unknown;
      try {
        parsed = JSON.parse(removeJsonFence(response));
      } catch {
        throw new Error("LLM returned invalid JSON");
      }
      const analysis = JobMatchAnalysisSchema.parse(parsed);
      await saveJobAnalysisCache(job, analysis);
      return analysis;
    } catch (error) {
      previousError =
        error instanceof z.ZodError
          ? new Error(
              error.issues
                .slice(0, 6)
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")
            )
          : error instanceof Error
            ? error
            : new Error(String(error));
    }
  }

  throw previousError ?? new Error("Job analysis failed");
}
