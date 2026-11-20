-- What a date asks for besides its event's parts (issue #549): instruments asked from the set.
ALTER TABLE "TeamEventDate" ADD COLUMN "asks" JSONB;

-- The roles a group fills at its organisation's events (issue #549): "Worship" fills Music.
ALTER TABLE "Team" ADD COLUMN "fills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
