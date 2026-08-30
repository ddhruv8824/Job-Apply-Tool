-- AlterEnum
ALTER TYPE "AgentRunType" ADD VALUE 'UNATTENDED_AUTO_APPLY';

-- AlterTable
ALTER TABLE "AgentRun"
ADD COLUMN "attemptedJobs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "alreadyAppliedJobs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "questionnaireJobs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "needsInputJobs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "skippedJobs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "failedJobs" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ApplicationAttempt" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" TEXT NOT NULL,
    CONSTRAINT "ApplicationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplicationAttempt_attemptedAt_idx" ON "ApplicationAttempt"("attemptedAt");
CREATE INDEX "ApplicationAttempt_applicationId_attemptedAt_idx" ON "ApplicationAttempt"("applicationId", "attemptedAt");

-- AddForeignKey
ALTER TABLE "ApplicationAttempt" ADD CONSTRAINT "ApplicationAttempt_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
