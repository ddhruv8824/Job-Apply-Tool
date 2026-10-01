import type { DiscoveryConfig } from "./discoverDirectJobs.js";

function positiveInteger(environment: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function optionalYears(environment: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = environment[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

export function getSearchKeyword(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.JOB_KEYWORD?.trim() || "Frontend Developer";
}

export function getSearchLocation(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.JOB_LOCATION?.trim() ?? "Pune";
}

export function getDiscoveryConfig(environment: NodeJS.ProcessEnv = process.env): DiscoveryConfig {
  return {
    keyword: getSearchKeyword(environment),
    location: getSearchLocation(environment),
    minExperience: optionalYears(environment, "JOB_MIN_EXPERIENCE"),
    maxExperience: optionalYears(environment, "JOB_MAX_EXPERIENCE"),
    targetDirectJobs: positiveInteger(environment, "TARGET_DIRECT_JOBS", 10),
    maxJobsToInspect: positiveInteger(environment, "MAX_JOBS_TO_INSPECT", 60),
    maxPages: positiveInteger(environment, "MAX_SEARCH_PAGES", 5),
  };
}
