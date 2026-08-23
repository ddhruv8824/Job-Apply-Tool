import type { CandidateProfile } from "../resume/candidateProfile.schema.js";
import { canonicalSkill, normalizeSkill, SKILL_ALIASES, SKILL_RELATIONS } from "./skillRelations.js";

export type CapabilityStatus = "EXPLICIT" | "STRONG_INFERENCE" | "WEAK_INFERENCE" | "UNKNOWN" | "CONTRADICTED";
export type CandidateCapability = {
  skill: string;
  status: CapabilityStatus;
  confidence: number;
  evidence: string[];
  derivedFrom?: string[];
};

function addExplicit(map: Map<string, CandidateCapability>, skill: string, evidence: string): void {
  const clean = skill.trim();
  if (!clean) return;
  const key = canonicalSkill(clean);
  const existing = map.get(key);
  map.set(key, {
    skill: existing?.skill ?? clean,
    status: "EXPLICIT",
    confidence: 1,
    evidence: [...new Set([...(existing?.evidence ?? []), evidence])],
  });
}

function mentionedKnownSkills(text: string): string[] {
  const normalized = normalizeSkill(text);
  const known = new Set([...Object.keys(SKILL_ALIASES), ...Object.keys(SKILL_RELATIONS)]);
  return [...known].filter((phrase) => {
    if (phrase.length < 3) return false;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(normalized);
  });
}

export function buildCandidateCapabilities(profile: CandidateProfile): Map<string, CandidateCapability> {
  const map = new Map<string, CandidateCapability>();
  for (const skill of profile.skills) addExplicit(map, skill, `${skill} exists in CandidateProfile skills`);
  for (const entry of profile.workExperience) {
    for (const skill of entry.technologies) addExplicit(map, skill, `${skill} is listed for ${entry.role}${entry.company ? ` at ${entry.company}` : ""}`);
    for (const bullet of entry.description) {
      for (const skill of mentionedKnownSkills(bullet)) addExplicit(map, skill, `Resume work evidence mentions ${skill}`);
    }
  }
  for (const project of profile.projects) {
    for (const skill of project.technologies) addExplicit(map, skill, `${skill} is listed for project ${project.name}`);
    if (project.description) for (const skill of mentionedKnownSkills(project.description)) addExplicit(map, skill, `Project ${project.name} mentions ${skill}`);
  }

  // Snapshot ensures inferred capabilities never create further inferred chains.
  for (const [sourceKey, source] of [...map.entries()]) {
    for (const relation of SKILL_RELATIONS[sourceKey] ?? []) {
      const targetKey = canonicalSkill(relation.target);
      const existing = map.get(targetKey);
      if (existing?.status === "EXPLICIT") continue;
      if (existing && existing.confidence > relation.confidence) continue;
      map.set(targetKey, {
        skill: relation.target,
        status: relation.level === "strong" ? "STRONG_INFERENCE" : "WEAK_INFERENCE",
        confidence: Math.max(existing?.confidence ?? 0, relation.confidence),
        derivedFrom: [...new Set([...(existing?.derivedFrom ?? []), source.skill])],
        evidence: [...new Set([...(existing?.evidence ?? []), `${source.skill} provides conservative evidence of ${relation.target} capability`])],
      });
    }
  }
  return map;
}

export function resolveCapability(map: Map<string, CandidateCapability>, skill: string): CandidateCapability {
  return map.get(canonicalSkill(skill)) ?? { skill: skill.trim(), status: "UNKNOWN", confidence: 0.15, evidence: [] };
}
