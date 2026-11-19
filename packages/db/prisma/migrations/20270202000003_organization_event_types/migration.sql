-- An organisation's event types, offered to all its groups (issue #528).
ALTER TABLE "TeamEventType" ALTER COLUMN "teamId" DROP NOT NULL;
ALTER TABLE "TeamEventType" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "TeamEventType" ADD CONSTRAINT "TeamEventType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "TeamEventType_organizationId_name_key" ON "TeamEventType"("organizationId", "name");
-- One owner, never both or neither.
ALTER TABLE "TeamEventType" ADD CONSTRAINT "TeamEventType_one_owner" CHECK (("teamId" IS NULL) <> ("organizationId" IS NULL));
