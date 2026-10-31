-- Server backups (issue #119): their settings, and each run.
-- CreateTable
CREATE TABLE "BackupSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN,
    "endpoint" TEXT,
    "region" TEXT,
    "bucket" TEXT,
    "prefix" TEXT,
    "accessKeyId" TEXT,
    "secretAccessKeyEnc" TEXT,
    "hourUtc" INTEGER,
    "keepDaily" INTEGER,
    "keepWeekly" INTEGER,
    "keepMonthly" INTEGER,
    "fileRetentionDays" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "databaseKey" TEXT,
    "databaseBytes" BIGINT,
    "filesCopied" INTEGER NOT NULL DEFAULT 0,
    "filesBytes" BIGINT NOT NULL DEFAULT 0,
    "filesKept" INTEGER NOT NULL DEFAULT 0,
    "filesMissing" INTEGER NOT NULL DEFAULT 0,
    "filesRemoved" INTEGER NOT NULL DEFAULT 0,
    "dumpsRemoved" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRun_startedAt_idx" ON "BackupRun"("startedAt");
