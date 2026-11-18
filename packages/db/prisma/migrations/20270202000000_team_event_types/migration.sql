-- A team's kinds of events (issue #523), what an event was made from, and
-- whether its dates get a set.
CREATE TABLE "TeamEventType" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT,
    "durationMinutes" INTEGER,
    "callMinutes" INTEGER,
    "parts" JSONB NOT NULL,
    "withSet" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamEventType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamEventType_teamId_name_key" ON "TeamEventType"("teamId", "name");

ALTER TABLE "TeamEventType" ADD CONSTRAINT "TeamEventType_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamEvent" ADD COLUMN "typeId" TEXT,
ADD COLUMN "withSet" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "TeamEvent_typeId_idx" ON "TeamEvent"("typeId");

ALTER TABLE "TeamEvent" ADD CONSTRAINT "TeamEvent_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TeamEventType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
