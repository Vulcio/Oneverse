-- The parts someone would like to play on a date (issue #520), kept with
-- their answer by part key.
ALTER TABLE "TeamEventAnswer" ADD COLUMN "wishes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Hosting a team's dates (issue #520): a role's right, not something one lists oneself.
ALTER TABLE "Role" ADD COLUMN "canHost" BOOLEAN NOT NULL DEFAULT false;
