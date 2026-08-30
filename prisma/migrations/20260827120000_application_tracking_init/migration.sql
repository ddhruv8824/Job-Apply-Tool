-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ApplicationType" AS ENUM ('NAUKRI_DIRECT', 'EXTERNAL_COMPANY', 'WALK_IN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DISCOVERED', 'EXTERNAL_SKIPPED', 'DIRECT_FOUND', 'MATCHED', 'REVIEW', 'SKIP', 'READY_TO_APPLY', 'NEEDS_INPUT', 'QUESTIONNAIRE', 'APPLIED', 'ALREADY_APPLIED', 'AUTH_REQUIRED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "naukriJobId" TEXT,
    "jobUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "applicationType" "ApplicationType" NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL,
    "matchScore" DOUBLE PRECISION,
    "recommendation" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "questionnaireDetected" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL,
    "keyword" TEXT,
    "location" TEXT,
    "jobsInspected" INTEGER NOT NULL DEFAULT 0,
    "directJobs" INTEGER NOT NULL DEFAULT 0,
    "externalJobs" INTEGER NOT NULL DEFAULT 0,
    "previouslyAppliedSkipped" INTEGER NOT NULL DEFAULT 0,
    "matchedJobs" INTEGER NOT NULL DEFAULT 0,
    "readyToApplyJobs" INTEGER NOT NULL DEFAULT 0,
    "appliedJobs" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_naukriJobId_key" ON "Job"("naukriJobId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_jobUrl_key" ON "Job"("jobUrl");

-- CreateIndex
CREATE INDEX "Job_company_idx" ON "Job"("company");

-- CreateIndex
CREATE INDEX "Job_applicationType_idx" ON "Job"("applicationType");

-- CreateIndex
CREATE UNIQUE INDEX "Application_jobId_key" ON "Application"("jobId");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
