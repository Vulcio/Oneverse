-- Reference recordings per song, and what a version plays along to (issue #346).
-- CreateEnum
CREATE TYPE "SongLinkService" AS ENUM ('YOUTUBE', 'SPOTIFY', 'APPLE_MUSIC', 'DEEZER', 'OTHER');

-- AlterTable
ALTER TABLE "Arrangement" ADD COLUMN     "linkId" TEXT,
ADD COLUMN     "multitrackId" TEXT;

-- CreateTable
CREATE TABLE "SongLink" (
    "id" TEXT NOT NULL,
    "songVersionId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "service" "SongLinkService" NOT NULL,
    "value" TEXT,
    "label" TEXT NOT NULL,
    "startSeconds" INTEGER,
    "addedByUserId" TEXT,
    "visibility" "AttachmentVisibility" NOT NULL DEFAULT 'PRIVATE',
    "visibleToTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SongLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SongLink_songVersionId_idx" ON "SongLink"("songVersionId");

-- CreateIndex
CREATE INDEX "SongLink_addedByUserId_idx" ON "SongLink"("addedByUserId");

-- CreateIndex
CREATE INDEX "SongLink_visibleToTeamId_idx" ON "SongLink"("visibleToTeamId");

-- AddForeignKey
ALTER TABLE "Arrangement" ADD CONSTRAINT "Arrangement_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "SongLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongLink" ADD CONSTRAINT "SongLink_songVersionId_fkey" FOREIGN KEY ("songVersionId") REFERENCES "SongVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongLink" ADD CONSTRAINT "SongLink_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongLink" ADD CONSTRAINT "SongLink_visibleToTeamId_fkey" FOREIGN KEY ("visibleToTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
