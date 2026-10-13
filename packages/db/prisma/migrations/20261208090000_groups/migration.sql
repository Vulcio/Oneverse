-- Groups of an organisation (issue #241): whether a team uses Songverse, its parent group, its own positions.
-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "usesSongverse" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TeamMembership" ADD COLUMN     "positionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "TeamPosition" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamPosition_teamId_name_key" ON "TeamPosition"("teamId", "name");

-- CreateIndex
CREATE INDEX "Team_parentId_idx" ON "Team"("parentId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamPosition" ADD CONSTRAINT "TeamPosition_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

