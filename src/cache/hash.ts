import { createHash as nodeCreateHash } from "node:crypto";

export function createHash(value: string): string {
  return nodeCreateHash("sha256").update(value, "utf8").digest("hex");
}

export function isCacheReadEnabled(): boolean {
  return process.env.DISABLE_CACHE?.trim().toLowerCase() !== "true";
}
