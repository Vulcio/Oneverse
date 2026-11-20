-- What a date asks for besides its event's parts (issue #549): instruments asked from the set.
ALTER TABLE "TeamEventDate" ADD COLUMN "asks" JSONB;

-- The roles a group fills at its organisation's events (issue #549): "Worship" fills Music.
ALTER TABLE "Team" ADD COLUMN "fills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- A team's event asked to become its organisation's (issue #549): an organisation admin accepts or declines.
ALTER TABLE "TeamEvent" ADD COLUMN "transferRequestedAt" TIMESTAMP(3), ADD COLUMN "transferRequestedByUserId" TEXT;
ALTER TABLE "TeamEvent" ADD CONSTRAINT "TeamEvent_transferRequestedByUserId_fkey" FOREIGN KEY ("transferRequestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
