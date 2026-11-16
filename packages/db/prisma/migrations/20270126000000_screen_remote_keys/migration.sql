-- A screen's own keys move the set's slides for everyone (issue #195).
ALTER TABLE "Screen" ADD COLUMN "remoteKeys" BOOLEAN NOT NULL DEFAULT false;
