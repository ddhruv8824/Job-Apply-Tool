import { z } from "zod";

const score = z.number().min(0).max(100);
const strings = z.array(z.string().trim().min(1)).default([]);
const optionalString = z.preprocess(
  (value) => value === null ? undefined : value,
  z.string().trim().min(1).optional()
);
const optionalNumber = z.preprocess(
  (value) => value === null ? undefined : value,
  z.number().nonnegative().optional()
);

export const RequirementImportanceSchema = z.enum(["REQUIRED", "PREFERRED", "UNKNOWN"]);
export const RequirementCategorySchema = z.enum(["CORE_TECHNICAL", "SECONDARY_TECHNICAL", "TOOL", "DOMAIN", "SOFT_SKILL", "GENERIC"]);
export const CapabilityStatusSchema = z.enum(["EXPLICIT", "STRONG_INFERENCE", "WEAK_INFERENCE", "UNKNOWN", "CONTRADICTED"]);

export const JobRequirementSchema = z.object({
  name: z.string().trim().min(1),
  importance: RequirementImportanceSchema,
  category: RequirementCategorySchema,
  importanceConfidence: z.number().min(0).max(1),
  mandatoryEvidence: optionalString,
});
export type JobRequirement = z.infer<typeof JobRequirementSchema>;
export type RequirementImportance = z.infer<typeof RequirementImportanceSchema>;
export type RequirementCategory = z.infer<typeof RequirementCategorySchema>;

/** LLM semantic analysis. TypeScript independently owns skill scoring and routing. */
export const JobMatchAnalysisSchema = z.object({
  requirements: z.array(JobRequirementSchema).default([]),
  requiredExperienceYears: optionalNumber,
  preferredExperienceYears: optionalNumber,
  responsibilities: strings,
  roleType: optionalString,
  seniority: optionalString,
  experienceMatchScore: score,
  roleMatchScore: score,
  responsibilityMatchScore: score,
  matchedEvidence: strings,
  strengths: strings,
  concerns: strings,
  reason: z.string().trim().min(1),
});
export type JobMatchAnalysis = z.infer<typeof JobMatchAnalysisSchema>;

export const SkillMatchDetailSchema = z.object({
  skill: z.string().trim().min(1),
  requirementImportance: RequirementImportanceSchema,
  category: RequirementCategorySchema,
  capabilityStatus: CapabilityStatusSchema,
  confidence: z.number().min(0).max(1),
  evidence: strings,
  derivedFrom: strings.optional(),
});
export type SkillMatchDetail = z.infer<typeof SkillMatchDetailSchema>;

export const MatchResultSchema = z.object({
  jobId: z.string().optional(), title: z.string().min(1), company: z.string().min(1), jobUrl: z.string().url(),
  overallScore: score, skillMatchScore: score, experienceMatchScore: score, roleMatchScore: score, responsibilityMatchScore: score,
  skillMatches: z.array(SkillMatchDetailSchema), unknownSkills: strings, hardMissingRequirements: strings,
  matchedSkills: strings, missingRequiredSkills: strings, missingPreferredSkills: strings,
  matchedEvidence: strings, strengths: strings, concerns: strings,
  recommendation: z.enum(["APPLY", "REVIEW", "SKIP"]), reason: z.string().trim().min(1),
});
export type MatchResult = z.infer<typeof MatchResultSchema>;
