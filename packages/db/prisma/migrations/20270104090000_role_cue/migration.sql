-- Cue (issue #322): a role that moves a set's screens to the next or previous song or section.
ALTER TABLE "Role" ADD COLUMN "canCue" BOOLEAN NOT NULL DEFAULT false;
