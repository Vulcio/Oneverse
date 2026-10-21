-- A Bible in the sidebar (issue #310), turned on by a team's or an organisation's admins.
ALTER TABLE "Team" ADD COLUMN "bible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "bible" BOOLEAN NOT NULL DEFAULT false;
