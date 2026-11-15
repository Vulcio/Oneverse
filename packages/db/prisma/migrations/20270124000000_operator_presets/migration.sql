-- The operator's named timers and quick messages, for a team's sets or a person's own (issue #358).
ALTER TABLE "Team" ADD COLUMN "operatorPresets" JSONB;
ALTER TABLE "User" ADD COLUMN "operatorPresets" JSONB;
