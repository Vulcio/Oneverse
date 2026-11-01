-- Teams' and organisations' own roles (issue #206, #300, #270): a name is unique per owner.
-- DropIndex
DROP INDEX "Role_name_key";

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "ownerKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "ownerOrganizationId" TEXT,
ADD COLUMN     "ownerTeamId" TEXT;

-- CreateIndex
CREATE INDEX "Role_ownerTeamId_idx" ON "Role"("ownerTeamId");

-- CreateIndex
CREATE INDEX "Role_ownerOrganizationId_idx" ON "Role"("ownerOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_ownerKey_name_key" ON "Role"("ownerKey", "name");

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_ownerOrganizationId_fkey" FOREIGN KEY ("ownerOrganizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
