-- An organisation's events (issue #241): host, timing, the groups they need (linked team events), presets.
-- AlterTable
ALTER TABLE "TeamEvent" ADD COLUMN     "organizationEventId" TEXT;

-- CreateTable
CREATE TABLE "OrganizationEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 90,
    "timeZone" TEXT NOT NULL,
    "place" TEXT,
    "note" TEXT,
    "repeatEveryWeeks" INTEGER,
    "repeatUntil" DATE,
    "hostUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationEventPreset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 90,
    "place" TEXT,
    "needs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationEventPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationEvent_organizationId_idx" ON "OrganizationEvent"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationEventPreset_organizationId_name_key" ON "OrganizationEventPreset"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TeamEvent_organizationEventId_teamId_key" ON "TeamEvent"("organizationEventId", "teamId");

-- AddForeignKey
ALTER TABLE "TeamEvent" ADD CONSTRAINT "TeamEvent_organizationEventId_fkey" FOREIGN KEY ("organizationEventId") REFERENCES "OrganizationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationEvent" ADD CONSTRAINT "OrganizationEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationEvent" ADD CONSTRAINT "OrganizationEvent_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationEvent" ADD CONSTRAINT "OrganizationEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationEventPreset" ADD CONSTRAINT "OrganizationEventPreset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

