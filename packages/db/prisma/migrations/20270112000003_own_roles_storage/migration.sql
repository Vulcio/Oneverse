-- An organisation's own roles let their holders keep files in its own bucket (issue #206).
ALTER TABLE "Role" ADD COLUMN "canStoreFiles" BOOLEAN NOT NULL DEFAULT false;

-- Only the holders of a team's or an organisation's own roles use its own
-- Sonic server from now on (issue #300). So that nobody who used one loses it,
-- each existing server's owner gets a "Stem separation" role of its own, given
-- to everyone who could use it: a team's members, an organisation's teams.
INSERT INTO "Role" (id, name, description, "canSeparateStems", "ownerTeamId", "ownerKey", "updatedAt")
SELECT 'own_stems_' || s."teamId", 'Stem separation', 'Splits recordings into stems on this team''s own Songverse Sonic server.', true, s."teamId", 'team:' || s."teamId", now()
FROM "SonicServer" s WHERE s."teamId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "Role" (id, name, description, "canSeparateStems", "ownerOrganizationId", "ownerKey", "updatedAt")
SELECT 'own_stems_' || s."organizationId", 'Stem separation', 'Splits recordings into stems on this organisation''s own Songverse Sonic server.', true, s."organizationId", 'organization:' || s."organizationId", now()
FROM "SonicServer" s WHERE s."organizationId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "RoleAssignment" (id, "roleId", "userId", "scopeTeamId", "scopeKey")
SELECT 'own_stems_' || m."teamId" || '_' || m."userId", 'own_stems_' || m."teamId", m."userId", m."teamId", 'team:' || m."teamId"
FROM "TeamMembership" m JOIN "SonicServer" s ON s."teamId" = m."teamId"
ON CONFLICT DO NOTHING;

INSERT INTO "RoleAssignment" (id, "roleId", "teamId", "scopeOrganizationId", "scopeKey")
SELECT 'own_stems_' || t."organizationId" || '_' || t.id, 'own_stems_' || t."organizationId", t.id, t."organizationId", 'organization:' || t."organizationId"
FROM "Team" t JOIN "SonicServer" s ON s."organizationId" = t."organizationId"
ON CONFLICT DO NOTHING;
