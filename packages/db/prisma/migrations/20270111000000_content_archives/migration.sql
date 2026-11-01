-- People's, teams' and organisations' own backups (issue #351): archives made
-- and imported, and the weekly ones asked for.
CREATE TYPE "ContentArchiveKind" AS ENUM ('EXPORT', 'IMPORT');
CREATE TYPE "ContentArchiveStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');
CREATE TYPE "ArchiveTrigger" AS ENUM ('MANUAL', 'WEEKLY');
CREATE TYPE "ArchiveScope" AS ENUM ('USER', 'TEAM', 'ORGANIZATION');

CREATE TABLE "ContentArchive" (
    "id" TEXT NOT NULL,
    "kind" "ContentArchiveKind" NOT NULL,
    "status" "ContentArchiveStatus" NOT NULL DEFAULT 'PENDING',
    "trigger" "ArchiveTrigger" NOT NULL DEFAULT 'MANUAL',
    "scope" "ArchiveScope" NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "organizationId" TEXT,
    "requestedByUserId" TEXT,
    "storageKey" TEXT,
    "sizeBytes" BIGINT,
    "filename" TEXT,
    "summary" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ContentArchive_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArchiveSchedule" (
    "id" TEXT NOT NULL,
    "scope" "ArchiveScope" NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "organizationId" TEXT,
    "createdByUserId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentArchive_userId_idx" ON "ContentArchive"("userId");
CREATE INDEX "ContentArchive_teamId_idx" ON "ContentArchive"("teamId");
CREATE INDEX "ContentArchive_organizationId_idx" ON "ContentArchive"("organizationId");
CREATE INDEX "ContentArchive_storageKey_idx" ON "ContentArchive"("storageKey");
CREATE INDEX "ContentArchive_status_expiresAt_idx" ON "ContentArchive"("status", "expiresAt");
CREATE UNIQUE INDEX "ArchiveSchedule_userId_key" ON "ArchiveSchedule"("userId");
CREATE UNIQUE INDEX "ArchiveSchedule_teamId_key" ON "ArchiveSchedule"("teamId");
CREATE UNIQUE INDEX "ArchiveSchedule_organizationId_key" ON "ArchiveSchedule"("organizationId");

ALTER TABLE "ContentArchive" ADD CONSTRAINT "ContentArchive_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentArchive" ADD CONSTRAINT "ContentArchive_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentArchive" ADD CONSTRAINT "ContentArchive_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentArchive" ADD CONSTRAINT "ContentArchive_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ArchiveSchedule" ADD CONSTRAINT "ArchiveSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArchiveSchedule" ADD CONSTRAINT "ArchiveSchedule_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArchiveSchedule" ADD CONSTRAINT "ArchiveSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
