-- One set per event date, viewed by its teams, edited by the ones chosen (issue #578).

-- An organisation's event: every group's date points at the same set.
DROP INDEX "TeamEventDate_setlistId_key";
CREATE INDEX "TeamEventDate_setlistId_idx" ON "TeamEventDate"("setlistId");

-- Which teams edit: per event, and per date as an exception. Every team edits today's sets.
ALTER TABLE "TeamEvent" ADD COLUMN "editsSet" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TeamEventDate" ADD COLUMN "editsSet" BOOLEAN;

-- Set is the organisation's event's setting: on if any of its groups had sets.
ALTER TABLE "OrganizationEvent" ADD COLUMN "withSet" BOOLEAN NOT NULL DEFAULT true;
UPDATE "OrganizationEvent" o SET "withSet" = EXISTS (SELECT 1 FROM "TeamEvent" t WHERE t."organizationEventId" = o.id AND t."withSet");

ALTER TABLE "TeamEventType" ADD COLUMN "editingTeamIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TYPE "SetEditRequestStatus" AS ENUM ('PENDING', 'GRANTED', 'DECLINED');
CREATE TABLE "SetEditRequest" (
    "id" TEXT NOT NULL,
    "setlistId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SetEditRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "SetEditRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SetEditRequest_setlistId_userId_key" ON "SetEditRequest"("setlistId", "userId");
CREATE INDEX "SetEditRequest_userId_idx" ON "SetEditRequest"("userId");
ALTER TABLE "SetEditRequest" ADD CONSTRAINT "SetEditRequest_setlistId_fkey" FOREIGN KEY ("setlistId") REFERENCES "Setlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetEditRequest" ADD CONSTRAINT "SetEditRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetEditRequest" ADD CONSTRAINT "SetEditRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
