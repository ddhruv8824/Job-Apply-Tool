import { z } from "zod";
import { callLlm } from "../ai/llm.js";
import {
  CandidateProfileSchema,
  type CandidateProfile,
} from "./candidateProfile.schema.js";

const SYSTEM_PROMPT = `You are a resume information extraction system.

Convert the provided resume into structured candidate data.

STRICT RULES:
1. Use ONLY information explicitly supported by the resume.
2. Never invent skills, companies, technologies, projects, certifications, education, dates, titles, achievements, or years of experience.
3. Do not infer a technology because it is commonly associated with another technology.
4. Preserve factual wording. Do not strengthen or exaggerate claims.
5. If information is ambiguous or unavailable, omit optional fields or return an empty array.
6. Set totalExperienceYears only if the resume explicitly states total experience. Do not estimate it.
7. Create projects only from an explicit project section or clearly named projects.
8. Keep targetRoles conservative: use explicit target roles or actual role titles only.
9. Copy names, role titles, company names, institution names, project names, and dates verbatim from the resume. Do not correct spelling or convert date formats.
10. Include every named entry under WORK EXPERIENCE. Do not omit an employer. If the current employment entry has no separate role label, use the resume's top-level current role verbatim.
11. Extract currentRole when the resume displays a role/title beside the candidate name.
12. Return only valid JSON. Do not include markdown, commentary, or code fences.`;

const REQUIRED_SHAPE = `{
  "name"?: string,
  "currentRole"?: string,
  "totalExperienceYears"?: number,
  "targetRoles": string[],
  "skills": string[],
  "workExperience": [{
    "company"?: string,
    "role": string,
    "startDate"?: string,
    "endDate"?: string,
    "description": string[],
    "technologies": string[]
  }],
  "projects": [{
    "name": string,
    "description"?: string,
    "technologies": string[]
  }],
  "education": [{
    "degree"?: string,
    "institution"?: string,
    "year"?: string
  }],
  "certifications": string[]
}`;

function removeSurroundingJsonFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? text.trim();
}

function cleanString(value: string): string {
  return value.replace(/[\t\u00a0 ]+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  const unique = new Map<string, string>();
  for (const rawValue of values) {
    const value = cleanString(rawValue);
    if (value) unique.set(value.toLocaleLowerCase(), value);
  }
  return [...unique.values()];
}

function searchable(value: string): string {
  return ` ${value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function isSupported(resumeText: string, value: string): boolean {
  const needle = searchable(value);
  if (needle.trim().length === 0) return false;

  const haystack = searchable(resumeText);
  if (haystack.includes(needle)) return true;

  // PDF columns can concatenate adjacent text without a separating space.
  const compactNeedle = needle.replace(/[^a-z0-9+#.]/g, "");
  const compactHaystack = haystack.replace(/[^a-z0-9+#.]/g, "");
  return compactNeedle.length >= 4 && compactHaystack.includes(compactNeedle);
}

function cleanOptional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = cleanString(value);
  return cleaned || undefined;
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? Number.POSITIVE_INFINITY;
}

function keepSupported(
  resumeText: string,
  values: string[],
  removed: Set<string>
): string[] {
  const separatedValues = values.flatMap((value) => value.split("|"));
  return uniqueStrings(separatedValues).filter((value) => {
    const supported = isSupported(resumeText, value);
    if (!supported) removed.add(value);
    return supported;
  });
}

function extractExplicitTotalExperience(resumeText: string): number | undefined {
  const match = resumeText.match(
    /(?:experience[^\n]{0,40}?|\bwith\s+)(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)\b/i
  );
  if (!match?.[1]) return undefined;
  const years = Number(match[1]);
  return Number.isFinite(years) && years >= 0 ? years : undefined;
}

function expectedWorkCompanies(resumeText: string): string[] {
  const section = resumeText.match(
    /WORK EXPERIENCE\s*\n([\s\S]*?)(?:\nPROJECTS\b|\nEDUCATION\b|$)/i
  )?.[1];
  if (!section) return [];

  const companies: string[] = [];
  for (const line of section.split("\n")) {
    const match = line
      .trim()
      .match(/^(.+?)\s+(\d{4}(?:\([A-Za-z]+\))?)\s*-\s*(Present|\d{4})$/i);
    if (match?.[1]) companies.push(cleanString(match[1]));
  }
  return uniqueStrings(companies);
}

function requireSupported(
  resumeText: string,
  label: string,
  value: string | undefined,
  errors: string[]
): void {
  if (value && !isSupported(resumeText, value)) {
    errors.push(`${label}: ${value}`);
  }
}

function explicitlySupportsExperience(
  resumeText: string,
  years: number
): boolean {
  if (extractExplicitTotalExperience(resumeText) === years) return true;
  const escaped = String(years).replace(".", "\\.");
  return new RegExp(
    `(?:${escaped}\\+?\\s*(?:years?|yrs?)|(?:years?|yrs?)\\s*(?:of\\s*)?${escaped})[^\\n]{0,30}experience`,
    "i"
  ).test(resumeText);
}

function cleanAndVerifyProfile(
  profile: CandidateProfile,
  resumeText: string
): CandidateProfile {
  const removed = new Set<string>();
  const unsupportedEntities: string[] = [];

  const name = cleanOptional(profile.name);
  const currentRole = cleanOptional(profile.currentRole);
  requireSupported(resumeText, "name", name, unsupportedEntities);
  requireSupported(resumeText, "currentRole", currentRole, unsupportedEntities);

  const workExperience = profile.workExperience.map((entry, index) => {
    const company = cleanOptional(entry.company);
    let role = cleanString(entry.role);
    const startDate = cleanOptional(entry.startDate);
    const endDate = cleanOptional(entry.endDate);
    if (
      !isSupported(resumeText, role) &&
      currentRole &&
      /present|current/i.test(endDate ?? "") &&
      editDistance(role.toLocaleLowerCase(), currentRole.toLocaleLowerCase()) <= 2
    ) {
      role = currentRole;
    }
    requireSupported(resumeText, `workExperience[${index}].company`, company, unsupportedEntities);
    requireSupported(resumeText, `workExperience[${index}].role`, role, unsupportedEntities);
    requireSupported(resumeText, `workExperience[${index}].startDate`, startDate, unsupportedEntities);
    requireSupported(resumeText, `workExperience[${index}].endDate`, endDate, unsupportedEntities);
    return {
      company,
      role,
      startDate,
      endDate,
      description: uniqueStrings(entry.description),
      technologies: keepSupported(resumeText, entry.technologies, removed),
    };
  });

  const returnedCompanies = workExperience
    .map((entry) => entry.company?.toLocaleLowerCase())
    .filter((value): value is string => Boolean(value));
  const omittedCompanies = expectedWorkCompanies(resumeText).filter(
    (company) => !returnedCompanies.includes(company.toLocaleLowerCase())
  );
  if (omittedCompanies.length > 0) {
    throw new Error(
      `Truth validation detected omitted work experience: ${omittedCompanies.join(", ")}`
    );
  }

  const projects = profile.projects.map((project, index) => {
    const nameValue = cleanString(project.name);
    requireSupported(resumeText, `projects[${index}].name`, nameValue, unsupportedEntities);
    return {
      name: nameValue,
      description: cleanOptional(project.description),
      technologies: keepSupported(resumeText, project.technologies, removed),
    };
  });

  const education = profile.education.map((entry, index) => {
    const degree = cleanOptional(entry.degree);
    const institution = cleanOptional(entry.institution);
    const year = cleanOptional(entry.year);
    requireSupported(resumeText, `education[${index}].degree`, degree, unsupportedEntities);
    requireSupported(resumeText, `education[${index}].institution`, institution, unsupportedEntities);
    requireSupported(resumeText, `education[${index}].year`, year, unsupportedEntities);
    return { degree, institution, year };
  });

  if (unsupportedEntities.length > 0) {
    throw new Error(
      "Truth validation rejected unsupported entities:\n- " +
        unsupportedEntities.join("\n- ")
    );
  }

  const actualRoles = [currentRole, ...workExperience.map((entry) => entry.role)]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLocaleLowerCase());
  const targetRoles = uniqueStrings(profile.targetRoles).filter((role) => {
    const supported =
      isSupported(resumeText, role) || actualRoles.includes(role.toLocaleLowerCase());
    if (!supported) removed.add(role);
    return supported;
  });

  let totalExperienceYears =
    profile.totalExperienceYears ?? extractExplicitTotalExperience(resumeText);
  if (
    totalExperienceYears !== undefined &&
    !explicitlySupportsExperience(resumeText, totalExperienceYears)
  ) {
    removed.add(`totalExperienceYears=${totalExperienceYears}`);
    totalExperienceYears = undefined;
  }

  const projectNames = new Set(
    projects.map((project) => project.name.toLocaleLowerCase())
  );
  const skills = keepSupported(resumeText, profile.skills, removed).filter(
    (skill) => {
      const isProjectName = projectNames.has(skill.toLocaleLowerCase());
      if (isProjectName) removed.add(`${skill} (project name, not skill)`);
      return !isProjectName;
    }
  );

  if (removed.size > 0) {
    console.warn(
      `Truth validation removed ${removed.size} unsupported or misclassified value(s): ${[...removed].join(", ")}`
    );
  }

  return CandidateProfileSchema.parse({
    name,
    currentRole,
    totalExperienceYears,
    targetRoles,
    skills,
    workExperience,
    projects,
    education,
    certifications: keepSupported(resumeText, profile.certifications, removed),
  });
}

export async function buildCandidateProfile(
  resumeText: string
): Promise<CandidateProfile> {
  let previousError: Error | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      console.log(`Calling Groq...${attempt === 2 ? " (single correction retry)" : ""}`);
      const correction = previousError
        ? `\n\nThe previous extraction was rejected: ${previousError.message}\nCorrect that problem using only the resume.`
        : "";
      const response = await callLlm([
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Required JSON structure:\n${REQUIRED_SHAPE}\n\nRESUME START\n${resumeText}\nRESUME END${correction}`,
        },
      ]);
      console.log("LLM extraction: SUCCESS");

      let parsed: unknown;
      try {
        parsed = JSON.parse(removeSurroundingJsonFence(response));
      } catch {
        throw new Error("LLM returned invalid JSON.");
      }
      console.log("JSON parsing: PASSED");

      let validated: CandidateProfile;
      try {
        validated = CandidateProfileSchema.parse(parsed);
      } catch (error) {
        if (error instanceof z.ZodError) {
          const issues = error.issues
            .slice(0, 8)
            .map((issue) => `${issue.path.join(".") || "profile"}: ${issue.message}`)
            .join("; ");
          throw new Error(`Candidate profile validation failed: ${issues}`);
        }
        throw error;
      }
      console.log("Zod validation: PASSED");

      const profile = cleanAndVerifyProfile(validated, resumeText);
      console.log("Truth checks: PASSED");
      return profile;
    } catch (error) {
      previousError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 1) {
        console.warn(`Extraction validation failed; retrying once: ${previousError.message}`);
      }
    }
  }

  throw previousError ?? new Error("Failed to generate candidate profile.");
}
