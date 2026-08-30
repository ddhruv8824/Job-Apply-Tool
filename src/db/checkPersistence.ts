import { shouldSkipBecauseAlreadyApplied, statusForRecommendation } from "./status.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

expect(shouldSkipBecauseAlreadyApplied("APPLIED"), "APPLIED must be a permanent blocker");
expect(shouldSkipBecauseAlreadyApplied("ALREADY_APPLIED"), "ALREADY_APPLIED must be a permanent blocker");
for (const status of ["REVIEW", "SKIP", "MATCHED", "READY_TO_APPLY", "FAILED", "UNKNOWN"]) {
  expect(!shouldSkipBecauseAlreadyApplied(status), `${status} must remain reprocessable`);
}
expect(statusForRecommendation("APPLY") === "READY_TO_APPLY", "APPLY status mapping failed");
expect(statusForRecommendation("REVIEW") === "REVIEW", "REVIEW status mapping failed");
expect(statusForRecommendation("SKIP") === "SKIP", "SKIP status mapping failed");

console.log("Permanent duplicate blocker logic: PASSED");
console.log("REVIEW/SKIP reprocessing logic: PASSED");
console.log("Match recommendation mapping: PASSED");
