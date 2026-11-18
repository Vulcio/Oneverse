-- Speaking at a team's dates (issue #523): a role's right, like hosting.
ALTER TABLE "Role" ADD COLUMN "canSpeak" BOOLEAN NOT NULL DEFAULT false;
