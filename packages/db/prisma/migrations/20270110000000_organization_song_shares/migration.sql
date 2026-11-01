-- A song shared with a whole organisation (issue #350), to view.
ALTER TABLE "AccessGrant" ADD COLUMN "grantedToOrganizationId" TEXT;
CREATE UNIQUE INDEX "AccessGrant_songVersionId_grantedToOrganizationId_key" ON "AccessGrant"("songVersionId", "grantedToOrganizationId");
CREATE INDEX "AccessGrant_grantedToOrganizationId_idx" ON "AccessGrant"("grantedToOrganizationId");
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_grantedToOrganizationId_fkey" FOREIGN KEY ("grantedToOrganizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
