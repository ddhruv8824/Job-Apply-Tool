import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const CandidateProfileSchema = z.object({
  name: nonEmptyString.optional(),
  currentRole: nonEmptyString.optional(),
  totalExperienceYears: z.number().nonnegative().optional(),
  targetRoles: z.array(nonEmptyString).default([]),
  skills: z.array(nonEmptyString).default([]),
  workExperience: z
    .array(
      z.object({
        company: nonEmptyString.optional(),
        role: nonEmptyString,
        startDate: nonEmptyString.optional(),
        endDate: nonEmptyString.optional(),
        description: z.array(nonEmptyString).default([]),
        technologies: z.array(nonEmptyString).default([]),
      })
    )
    .default([]),
  projects: z
    .array(
      z.object({
        name: nonEmptyString,
        description: nonEmptyString.optional(),
        technologies: z.array(nonEmptyString).default([]),
      })
    )
    .default([]),
  education: z
    .array(
      z.object({
        degree: nonEmptyString.optional(),
        institution: nonEmptyString.optional(),
        year: nonEmptyString.optional(),
      })
    )
    .default([]),
  certifications: z.array(nonEmptyString).default([]),
});

export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;
