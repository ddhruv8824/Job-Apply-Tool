import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import { buildCandidateCapabilities, resolveCapability } from "./capabilities.js";
import type { JobMatchAnalysis, MatchResult, RequirementCategory, RequirementImportance, SkillMatchDetail } from "./match.schema.js";

export const MATCH_WEIGHTS = { skill: 0.4, experience: 0.2, role: 0.2, responsibility: 0.2 } as const;
export const REQUIREMENT_CATEGORY_WEIGHTS: Record<RequirementCategory, number> = {
  CORE_TECHNICAL: 1, SECONDARY_TECHNICAL: 0.7, DOMAIN: 0.7, TOOL: 0.6, SOFT_SKILL: 0.2, GENERIC: 0.1,
};
export const REQUIREMENT_IMPORTANCE_WEIGHTS: Record<RequirementImportance, number> = {
  REQUIRED: 1, UNKNOWN: 0.6, PREFERRED: 0.4,
};

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function getRecommendation(score: number, hardBlocker: boolean): MatchResult["recommendation"] {
  if (hardBlocker) return "SKIP";
  if (score >= 85) return "APPLY";
  if (score >= 70) return "REVIEW";
  return "SKIP";
}

export function calculateMatchScore(profile: CandidateProfile, analysis: JobMatchAnalysis): {
  overallScore: number; skillMatchScore: number; skillMatches: SkillMatchDetail[];
  unknownSkills: string[]; hardMissingRequirements: string[]; matchedSkills: string[];
  missingRequiredSkills: string[]; missingPreferredSkills: string[];
  recommendation: MatchResult["recommendation"];
} {
  const capabilities = buildCandidateCapabilities(profile);
  const skillMatches: SkillMatchDetail[] = [];
  let earned = 0;
  let possible = 0;

  for (const requirement of analysis.requirements) {
    const capability = resolveCapability(capabilities, requirement.name);
    const weight = REQUIREMENT_CATEGORY_WEIGHTS[requirement.category] * REQUIREMENT_IMPORTANCE_WEIGHTS[requirement.importance];
    const credit = capability.status === "CONTRADICTED"
      ? 0
      : capability.status === "UNKNOWN"
        ? requirement.importance === "PREFERRED" ? 0.65 : requirement.importance === "UNKNOWN" ? 0.3 : 0.1
        : capability.confidence;
    earned += credit * weight;
    possible += weight;
    skillMatches.push({
      skill: requirement.name,
      requirementImportance: requirement.importance,
      category: requirement.category,
      capabilityStatus: capability.status,
      confidence: capability.confidence,
      evidence: capability.evidence,
      derivedFrom: capability.derivedFrom,
    });
  }

  const skillMatchScore = possible > 0 ? Math.round((earned / possible) * 100) : 70;
  const unknownSkills = unique(skillMatches.filter((item) => item.capabilityStatus === "UNKNOWN").map((item) => item.skill));
  const hardMissingRequirements = unique(analysis.requirements.filter((requirement) => {
    const capability = resolveCapability(capabilities, requirement.name);
    return requirement.importance === "REQUIRED" && requirement.importanceConfidence >= 0.9 &&
      requirement.category === "CORE_TECHNICAL" && Boolean(requirement.mandatoryEvidence) &&
      (capability.status === "UNKNOWN" || capability.status === "CONTRADICTED");
  }).map((requirement) => requirement.name));
  const missingRequiredSkills = unique(skillMatches.filter((item) => item.requirementImportance === "REQUIRED" && (item.capabilityStatus === "UNKNOWN" || item.capabilityStatus === "CONTRADICTED")).map((item) => item.skill));
  const missingPreferredSkills = unique(skillMatches.filter((item) => item.requirementImportance === "PREFERRED" && item.capabilityStatus === "UNKNOWN").map((item) => item.skill));
  const matchedSkills = unique(skillMatches.filter((item) => ["EXPLICIT", "STRONG_INFERENCE", "WEAK_INFERENCE"].includes(item.capabilityStatus)).map((item) => item.skill));

  let overallScore = Math.round(
    skillMatchScore * MATCH_WEIGHTS.skill + analysis.experienceMatchScore * MATCH_WEIGHTS.experience +
    analysis.roleMatchScore * MATCH_WEIGHTS.role + analysis.responsibilityMatchScore * MATCH_WEIGHTS.responsibility
  );
  const experienceGap = analysis.requiredExperienceYears !== undefined && profile.totalExperienceYears !== undefined
    ? analysis.requiredExperienceYears - profile.totalExperienceYears : 0;
  const severeExperienceGap = experienceGap >= 3;
  const hardBlocker = hardMissingRequirements.length > 0 || severeExperienceGap;
  if (hardBlocker) overallScore = Math.min(overallScore, 69);
  else if (experienceGap > 0) overallScore = Math.min(overallScore, 84);

  return { overallScore, skillMatchScore, skillMatches, unknownSkills, hardMissingRequirements,
    matchedSkills, missingRequiredSkills, missingPreferredSkills,
    recommendation: getRecommendation(overallScore, hardBlocker) };
}
