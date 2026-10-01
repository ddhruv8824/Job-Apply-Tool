-- Switch job tracking from Naukri to Hirist while keeping existing application history.
ALTER TYPE "ApplicationType" RENAME VALUE 'NAUKRI_DIRECT' TO 'HIRIST_DIRECT';

ALTER TABLE "Job" RENAME COLUMN "naukriJobId" TO "hiristJobId";
ALTER INDEX "Job_naukriJobId_key" RENAME TO "Job_hiristJobId_key";

-- Legacy rows keep their URL for history, but their Naukri IDs must not be read as Hirist IDs.
UPDATE "Job" SET "hiristJobId" = NULL WHERE "jobUrl" NOT LIKE 'https://www.hirist.tech/%';
