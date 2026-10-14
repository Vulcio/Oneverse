-- A screen is a person's, a team's or an organisation's (issue #222), and
-- reads its set as whoever put it there.
ALTER TABLE "Screen" ADD COLUMN     "ownerOrganizationId" TEXT,
ADD COLUMN     "ownerTeamId" TEXT,
ADD COLUMN     "setByUserId" TEXT,
ALTER COLUMN "ownerUserId" DROP NOT NULL;

-- Until now, the person who paired it put its set on it.
UPDATE "Screen" SET "setByUserId" = "ownerUserId" WHERE "setlistId" IS NOT NULL;

-- Exactly one owner.
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_one_owner" CHECK (num_nonnulls("ownerUserId", "ownerTeamId", "ownerOrganizationId") = 1);

-- CreateIndex
CREATE INDEX "Screen_ownerTeamId_idx" ON "Screen"("ownerTeamId");

-- CreateIndex
CREATE INDEX "Screen_ownerOrganizationId_idx" ON "Screen"("ownerOrganizationId");

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_ownerOrganizationId_fkey" FOREIGN KEY ("ownerOrganizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_setByUserId_fkey" FOREIGN KEY ("setByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
