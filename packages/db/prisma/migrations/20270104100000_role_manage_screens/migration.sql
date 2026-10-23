-- Manage devices (issue #322): a role that pairs, changes and disconnects a team's or an organisation's screens.
ALTER TABLE "Role" ADD COLUMN "canManageScreens" BOOLEAN NOT NULL DEFAULT false;
