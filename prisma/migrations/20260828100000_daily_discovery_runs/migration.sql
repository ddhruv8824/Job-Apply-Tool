-- CreateEnum
CREATE TYPE "AgentRunType" AS ENUM ('INTERACTIVE', 'DAILY_DISCOVERY');

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN "runType" "AgentRunType" NOT NULL DEFAULT 'INTERACTIVE';

-- CreateIndex
CREATE INDEX "AgentRun_runType_status_startedAt_idx" ON "AgentRun"("runType", "status", "startedAt");
