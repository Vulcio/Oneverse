-- Issue #559: an organisation's event presets fold into its event types. A
-- type lists positions, each from a team (openTo): a preset's needs become
-- its parts, each from the team that was asked for it. A need with no parts
-- has nothing to keep; the type keeps the first need's call time and set.
ALTER TABLE "TeamEventType" ADD COLUMN "locationId" TEXT;
ALTER TABLE "TeamEventType" ADD CONSTRAINT "TeamEventType_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "TeamEventType" ("id", "organizationId", "name", "startTime", "durationMinutes", "callMinutes", "parts", "withSet", "locationId", "createdAt", "updatedAt")
SELECT
  'preset_' || p."id",
  p."organizationId",
  CASE WHEN EXISTS (SELECT 1 FROM "TeamEventType" t WHERE t."organizationId" = p."organizationId" AND t."name" = p."name") THEN left(p."name", 110) || ' (preset)' ELSE p."name" END,
  p."startTime",
  p."durationMinutes",
  NULLIF(p."needs"->0->>'callMinutes', '')::int,
  COALESCE((
    SELECT jsonb_agg(
      CASE WHEN jsonb_typeof(part->'openTo') = 'array' AND jsonb_array_length(part->'openTo') > 0 THEN part
      ELSE part || jsonb_build_object('openTo', jsonb_build_array(need->>'teamId')) END)
    FROM jsonb_array_elements(p."needs"::jsonb) AS need, jsonb_array_elements(COALESCE(need->'parts', '[]'::jsonb)) AS part
  ), '[]'::jsonb),
  COALESCE((p."needs"->0->>'withSet')::boolean, true),
  p."locationId",
  p."createdAt",
  now()
FROM "OrganizationEventPreset" p;

DROP TABLE "OrganizationEventPreset";
