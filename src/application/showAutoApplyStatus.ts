import { loadEnvFile } from "node:process";
import { getAutoApplyPolicy } from "./autoApplyPolicy.js";

try { loadEnvFile(); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}
const policy = getAutoApplyPolicy();
let database = "UNAVAILABLE";
let attempts: number | undefined;
if (process.env.DATABASE_URL?.trim()) {
  try {
    const [{ prisma }, { countApplicationAttemptsToday }] = await Promise.all([import("../db/prisma.js"), import("../db/applicationRepository.js")]);
    await prisma.$queryRaw`SELECT 1`;
    attempts = await countApplicationAttemptsToday();
    database = "AVAILABLE";
    await prisma.$disconnect();
  } catch { database = "UNAVAILABLE"; }
}
console.log("AUTO-APPLY STATUS\n");
console.log(`Enabled: ${policy.enabled ? "YES" : "NO"}`);
console.log(`Daily limit: ${policy.dailyLimit}`);
console.log(`Attempts today: ${attempts ?? "UNAVAILABLE"}`);
console.log(`Remaining: ${attempts === undefined ? "UNAVAILABLE" : Math.max(0, policy.dailyLimit - attempts)}`);
console.log(`Database: ${database}`);
console.log("No browser activity performed.");
