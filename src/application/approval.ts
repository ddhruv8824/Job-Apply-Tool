import type { ApplyResult } from "./application.js";

export function isExplicitApproval(answer: string): boolean {
  return /^(?:y|yes)$/i.test(answer.trim());
}

export async function runApplicationGate(options: {
  dryRun: boolean;
  approval?: string;
  verifyDryRun: () => Promise<ApplyResult>;
  applyLive: () => Promise<ApplyResult>;
}): Promise<ApplyResult | null> {
  if (options.dryRun) return options.verifyDryRun();
  if (!isExplicitApproval(options.approval ?? "")) return null;
  return options.applyLive();
}
