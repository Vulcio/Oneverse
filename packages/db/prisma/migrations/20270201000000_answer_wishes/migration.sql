-- The parts someone would like to play on a date (issue #520), kept with
-- their answer by part key.
ALTER TABLE "TeamEventAnswer" ADD COLUMN "wishes" TEXT[] DEFAULT ARRAY[]::TEXT[];
