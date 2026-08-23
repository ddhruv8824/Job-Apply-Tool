import { loadCandidateProfileCache, saveCandidateProfileCache } from "../cache/candidateProfileCache.js";
import type { CandidateProfile } from "./candidateProfile.schema.js";
import { buildCandidateProfile } from "./buildCandidateProfile.js";

export async function getCandidateProfile(resumeText: string): Promise<CandidateProfile> {
  const cached = await loadCandidateProfileCache(resumeText);
  if (cached) {
    console.log("Candidate profile cache: HIT");
    return cached;
  }
  console.log("Candidate profile cache: MISS");
  const profile = await buildCandidateProfile(resumeText);
  await saveCandidateProfileCache(resumeText, profile);
  return profile;
}
