import { readFile } from "node:fs/promises";
import path from "node:path";
import { ApplicationProfileSchema, type ApplicationProfile } from "./applicationProfile.schema.js";

export async function loadApplicationProfile(filePath = path.resolve("data", "applicationProfile.json")): Promise<ApplicationProfile> {
  try {
    return ApplicationProfileSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw new Error(`Invalid application profile: ${error instanceof Error ? error.message : String(error)}`);
  }
}
