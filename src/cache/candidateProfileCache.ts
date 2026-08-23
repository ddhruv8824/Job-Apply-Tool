import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { CandidateProfileSchema, type CandidateProfile } from "../resume/candidateProfile.schema.js";
import { createHash, isCacheReadEnabled } from "./hash.js";

const CACHE_PATH = path.resolve(".cache", "candidate-profile.json");

type CandidateProfileCache = { resumeHash: string; createdAt: string; profile: unknown };

export async function loadCandidateProfileCache(resumeText: string): Promise<CandidateProfile | null> {
  if (!isCacheReadEnabled()) return null;
  try {
    const cached = JSON.parse(await readFile(CACHE_PATH, "utf8")) as CandidateProfileCache;
    if (cached.resumeHash !== createHash(resumeText)) return null;
    return CandidateProfileSchema.parse(cached.profile);
  } catch {
    return null;
  }
}

export async function saveCandidateProfileCache(resumeText: string, profile: CandidateProfile): Promise<void> {
  const validated = CandidateProfileSchema.parse(profile);
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  const temporary = `${CACHE_PATH}.tmp`;
  await writeFile(temporary, JSON.stringify({ resumeHash: createHash(resumeText), createdAt: new Date().toISOString(), profile: validated }, null, 2), "utf8");
  await rename(temporary, CACHE_PATH);
}
