-- DropIndex
DROP INDEX "StemSeparation_jobId_key";

-- AlterTable
ALTER TABLE "StemSeparation" ADD COLUMN     "ownServer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sonicServerId" TEXT;

-- AlterTable
ALTER TABLE "StemSeparationSettings" ADD COLUMN     "ownServers" BOOLEAN,
ADD COLUMN     "ownServersPrivate" BOOLEAN;

-- CreateTable
CREATE TABLE "SonicServer" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "organizationId" TEXT,
    "apiUrl" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "callbackSecretEnc" TEXT NOT NULL,
    "fastModel" TEXT,
    "hqModel" TEXT,
    "hqEnabled" BOOLEAN NOT NULL DEFAULT true,
    "monthlyLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SonicServer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SonicServer_teamId_key" ON "SonicServer"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "SonicServer_organizationId_key" ON "SonicServer"("organizationId");

-- CreateIndex
CREATE INDEX "StemSeparation_jobId_idx" ON "StemSeparation"("jobId");

-- CreateIndex
CREATE INDEX "StemSeparation_sonicServerId_idx" ON "StemSeparation"("sonicServerId");

-- AddForeignKey
ALTER TABLE "SonicServer" ADD CONSTRAINT "SonicServer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SonicServer" ADD CONSTRAINT "SonicServer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StemSeparation" ADD CONSTRAINT "StemSeparation_sonicServerId_fkey" FOREIGN KEY ("sonicServerId") REFERENCES "SonicServer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

