import { z } from "zod";

const optionalText = z.string().trim().min(1).optional();

export const ApplicationProfileSchema = z.object({
  currentLocation: optionalText,
  preferredLocations: z.array(z.string().trim().min(1)).optional(),
  noticePeriodDays: z.number().int().nonnegative().optional(),
  currentCtc: z.number().nonnegative().optional(),
  expectedCtc: z.number().nonnegative().optional(),
  willingToRelocate: z.boolean().optional(),
  currentlyEmployed: z.boolean().optional(),
  workAuthorization: optionalText,
  joiningAvailability: optionalText,
  totalExperienceYears: z.number().nonnegative().optional(),
}).strict();

export type ApplicationProfile = z.infer<typeof ApplicationProfileSchema>;
