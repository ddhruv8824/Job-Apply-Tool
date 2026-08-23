import type { DetailedJob } from "../naukri/getJobDetails.js";
import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import { analyzeJobMatch } from "./analyzeJobMatch.js";
import { calculateMatchScore } from "./calculateMatchScore.js";
import { MatchResultSchema, type MatchResult } from "./match.schema.js";

export async function matchJobs(
  profile: CandidateProfile,
  jobs: DetailedJob[]
): Promise<MatchResult[]> {
  const matches: MatchResult[] = [];
  const eligibleJobs = jobs.filter((job) => job.applicationType === "NAUKRI_DIRECT");
  if (eligibleJobs.length !== jobs.length) {
    console.log(`AI safety filter: excluded ${jobs.length - eligibleJobs.length} non-direct job(s).`);
  }

  for (const [index, job] of eligibleJobs.entries()) {
    console.log(`[${index + 1}/${jobs.length}] ${job.title} — ${job.company}`);
    try {
      const analysis = await analyzeJobMatch(profile, job);
      const calculated = calculateMatchScore(profile, analysis);
      const result = MatchResultSchema.parse({
        jobId: job.jobId,
        title: job.title,
        company: job.company,
        jobUrl: job.jobUrl,
        overallScore: calculated.overallScore,
        skillMatchScore: calculated.skillMatchScore,
        experienceMatchScore: Math.round(analysis.experienceMatchScore),
        roleMatchScore: Math.round(analysis.roleMatchScore),
        responsibilityMatchScore: Math.round(
          analysis.responsibilityMatchScore
        ),
        skillMatches: calculated.skillMatches,
        unknownSkills: calculated.unknownSkills,
        hardMissingRequirements: calculated.hardMissingRequirements,
        matchedSkills: calculated.matchedSkills,
        missingRequiredSkills: calculated.missingRequiredSkills,
        missingPreferredSkills: calculated.missingPreferredSkills,
        matchedEvidence: analysis.matchedEvidence,
        strengths: analysis.strengths,
        concerns: analysis.concerns,
        recommendation: calculated.recommendation,
        reason: analysis.reason,
      });
      matches.push(result);

      console.log(`Skill Match: ${result.skillMatchScore}`);
      console.log(`Experience Match: ${result.experienceMatchScore}`);
      console.log(`Role Match: ${result.roleMatchScore}`);
      console.log(`Responsibility Match: ${result.responsibilityMatchScore}`);
      console.log(`Overall: ${result.overallScore}`);
      console.log(`Recommendation: ${result.recommendation}\n`);
    } catch (error) {
      console.warn(`Failed to analyze: ${job.title} — ${job.company}`);
      console.warn(error instanceof Error ? error.message : String(error));
      console.log();
    }
  }

  return matches.sort((left, right) => right.overallScore - left.overallScore);
}
