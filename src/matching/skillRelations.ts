export type SkillRelation = { target: string; confidence: number; level: "strong" | "weak" };

// Aliases are alternate spellings of the same skill, not capability inferences.
export const SKILL_ALIASES: Record<string, string> = {
  js: "javascript", javascript: "javascript", ts: "typescript", typescript: "typescript",
  react: "react", "react.js": "react", "react js": "react", reactjs: "react",
  node: "node.js", "node.js": "node.js", "node js": "node.js", nodejs: "node.js",
  next: "next.js", "next.js": "next.js", "next js": "next.js", nextjs: "next.js",
  "ci cd": "ci/cd", cicd: "ci/cd", "ci/cd": "ci/cd",
};

export function normalizeSkill(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function canonicalSkill(value: string): string {
  const normalized = normalizeSkill(value);
  return SKILL_ALIASES[normalized] ?? normalized;
}

// Conservative one-hop relationships. These are deliberately not expanded transitively.
export const SKILL_RELATIONS: Record<string, SkillRelation[]> = {
  react: [
    { target: "JavaScript", confidence: 0.95, level: "strong" },
    { target: "Frontend Development", confidence: 0.95, level: "strong" },
    { target: "HTML", confidence: 0.8, level: "strong" },
    { target: "CSS", confidence: 0.65, level: "weak" },
  ],
  "next.js": [
    { target: "React", confidence: 0.95, level: "strong" },
    { target: "JavaScript", confidence: 0.9, level: "strong" },
    { target: "Frontend Development", confidence: 0.9, level: "strong" },
    { target: "HTML", confidence: 0.8, level: "strong" },
    { target: "CSS", confidence: 0.65, level: "weak" },
  ],
  "node.js": [{ target: "JavaScript", confidence: 0.9, level: "strong" }],
  jenkins: [{ target: "CI/CD", confidence: 0.95, level: "strong" }],
  "aws lambda": [
    { target: "AWS", confidence: 0.95, level: "strong" },
    { target: "Serverless", confidence: 0.95, level: "strong" },
  ],
};
