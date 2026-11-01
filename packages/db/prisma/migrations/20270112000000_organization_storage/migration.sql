-- An organisation's own bucket for its teams' files (issue #206): where each
-- file is, who may connect one, and whether Admin allows it.
-- CreateEnum
CREATE TYPE "OwnStorageProvider" AS ENUM ('R2', 'S3', 'B2', 'WASABI');

-- CreateEnum
CREATE TYPE "OwnStorageState" AS ENUM ('ACTIVE', 'LEAVING');

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "storedInOrganizationId" TEXT;

-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN     "ownStorage" BOOLEAN;

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "canUseOwnStorage" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OrganizationStorage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "OwnStorageProvider" NOT NULL,
    "accountId" TEXT,
    "region" TEXT,
    "bucket" TEXT NOT NULL,
    "accessKeyId" TEXT NOT NULL,
    "secretAccessKeyEnc" TEXT NOT NULL,
    "state" "OwnStorageState" NOT NULL DEFAULT 'ACTIVE',
    "reachable" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationStorage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationStorage_organizationId_key" ON "OrganizationStorage"("organizationId");

-- CreateIndex
CREATE INDEX "Attachment_storedInOrganizationId_idx" ON "Attachment"("storedInOrganizationId");

-- AddForeignKey
ALTER TABLE "OrganizationStorage" ADD CONSTRAINT "OrganizationStorage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


