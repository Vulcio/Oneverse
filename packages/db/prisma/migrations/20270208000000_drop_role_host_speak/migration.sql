-- Issue #559: Host and Speaker are ordinary positions an event takes from a
-- team (or the admins fill), no longer a role's right.
ALTER TABLE "Role" DROP COLUMN "canHost",
DROP COLUMN "canSpeak";
