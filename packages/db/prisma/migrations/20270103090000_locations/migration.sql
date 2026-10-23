-- Locations (issue #320): where an organisation's or a team's events take place.
-- AlterTable
ALTER TABLE "OrganizationEvent" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "OrganizationEventPreset" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "TeamEvent" ADD COLUMN     "locationId" TEXT;

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "timeZone" TEXT NOT NULL,
    "ownerTeamId" TEXT,
    "ownerOrganizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_ownerTeamId_idx" ON "Location"("ownerTeamId");

-- CreateIndex
CREATE INDEX "Location_ownerOrganizationId_idx" ON "Location"("ownerOrganizationId");

-- CreateIndex
CREATE INDEX "OrganizationEvent_locationId_idx" ON "OrganizationEvent"("locationId");

-- CreateIndex
CREATE INDEX "TeamEvent_locationId_idx" ON "TeamEvent"("locationId");

-- AddForeignKey
ALTER TABLE "TeamEvent" ADD CONSTRAINT "TeamEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationEvent" ADD CONSTRAINT "OrganizationEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationEventPreset" ADD CONSTRAINT "OrganizationEventPreset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_ownerOrganizationId_fkey" FOREIGN KEY ("ownerOrganizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

