-- A set run live (issue #247, docs/live-session.md).
CREATE TYPE "LiveSessionStatus" AS ENUM ('LIVE', 'ENDED');

CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "setlistId" TEXT NOT NULL,
    "status" "LiveSessionStatus" NOT NULL DEFAULT 'LIVE',
    "epoch" INTEGER NOT NULL DEFAULT 0,
    "authority" TEXT NOT NULL DEFAULT 'cloud',
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LiveSession_setlistId_idx" ON "LiveSession"("setlistId");
CREATE INDEX "LiveSession_status_idx" ON "LiveSession"("status");
-- One LIVE session per set.
CREATE UNIQUE INDEX "LiveSession_one_live_per_set" ON "LiveSession"("setlistId") WHERE "status" = 'LIVE';

ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_setlistId_fkey" FOREIGN KEY ("setlistId") REFERENCES "Setlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
