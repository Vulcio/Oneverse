-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "locationId" TEXT,
    "ownerTeamId" TEXT,
    "ownerOrganizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventResource" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "teamEventId" TEXT,
    "organizationEventId" TEXT,
    "eventTypeId" TEXT,

    CONSTRAINT "EventResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Resource_ownerTeamId_idx" ON "Resource"("ownerTeamId");

-- CreateIndex
CREATE INDEX "Resource_ownerOrganizationId_idx" ON "Resource"("ownerOrganizationId");

-- CreateIndex
CREATE INDEX "EventResource_resourceId_idx" ON "EventResource"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "EventResource_teamEventId_resourceId_key" ON "EventResource"("teamEventId", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "EventResource_organizationEventId_resourceId_key" ON "EventResource"("organizationEventId", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "EventResource_eventTypeId_resourceId_key" ON "EventResource"("eventTypeId", "resourceId");

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_ownerOrganizationId_fkey" FOREIGN KEY ("ownerOrganizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventResource" ADD CONSTRAINT "EventResource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventResource" ADD CONSTRAINT "EventResource_teamEventId_fkey" FOREIGN KEY ("teamEventId") REFERENCES "TeamEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventResource" ADD CONSTRAINT "EventResource_organizationEventId_fkey" FOREIGN KEY ("organizationEventId") REFERENCES "OrganizationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventResource" ADD CONSTRAINT "EventResource_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "TeamEventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
