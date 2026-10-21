-- Roles given on a team or an organisation only (issue #270).
ALTER TABLE "Role" ADD COLUMN "teamAssignable" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "RoleAssignment" ADD COLUMN "scopeTeamId" TEXT,
ADD COLUMN "scopeOrganizationId" TEXT,
ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT '';

DROP INDEX "RoleAssignment_roleId_userId_key";
CREATE UNIQUE INDEX "RoleAssignment_roleId_userId_scopeKey_key" ON "RoleAssignment"("roleId", "userId", "scopeKey");
CREATE INDEX "RoleAssignment_scopeTeamId_idx" ON "RoleAssignment"("scopeTeamId");
CREATE INDEX "RoleAssignment_scopeOrganizationId_idx" ON "RoleAssignment"("scopeOrganizationId");

ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_scopeTeamId_fkey" FOREIGN KEY ("scopeTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_scopeOrganizationId_fkey" FOREIGN KEY ("scopeOrganizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The media operator (issue #270): runs a set's screens without editing the
-- set, given by a team's or an organisation's admins on their own.
INSERT INTO "Role" ("id", "name", "description", "builtIn", "canOperateScreens", "teamAssignable", "updatedAt")
VALUES ('role_media_operator', 'Media operator', 'Runs the screens of the sets they can open, without editing them.', 'MEDIA_OPERATOR', true, true, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
