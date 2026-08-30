import { prisma } from "./prisma.js";

const statuses = ["DISCOVERED", "EXTERNAL_SKIPPED", "DIRECT_FOUND", "MATCHED", "REVIEW", "SKIP", "READY_TO_APPLY", "QUESTIONNAIRE", "NEEDS_INPUT", "APPLIED", "ALREADY_APPLIED", "AUTH_REQUIRED", "FAILED", "UNKNOWN"] as const;

try {
  const [tracked, grouped, recent] = await Promise.all([
    prisma.job.count(),
    prisma.application.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.application.findMany({ take: 10, orderBy: { updatedAt: "desc" }, include: { job: true } }),
  ]);
  const counts = new Map(grouped.map((item) => [item.status, item._count._all]));
  console.log("================================\nAPPLICATION HISTORY\n================================\n");
  console.log(`Tracked jobs: ${tracked}\n`);
  for (const status of statuses) console.log(`${status}: ${counts.get(status) ?? 0}`);
  console.log("\nRecent:\n");
  if (!recent.length) console.log("None");
  recent.forEach((application, index) => {
    console.log(`${index + 1}. ${application.job.title} — ${application.job.company}`);
    if (application.matchScore !== null) console.log(`   Score: ${application.matchScore}%`);
    console.log(`   Status: ${application.status}`);
    if (application.appliedAt) console.log(`   Applied: ${application.appliedAt.toISOString()}`);
  });
} finally {
  await prisma.$disconnect();
}
