-- Someone's Quick selection (issue #334): songs gathered, then added to a set at once.
-- CreateTable
CREATE TABLE "QuickSelectionSong" (
    "userId" TEXT NOT NULL,
    "songVersionId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuickSelectionSong_pkey" PRIMARY KEY ("userId","songVersionId")
);

-- CreateIndex
CREATE INDEX "QuickSelectionSong_songVersionId_idx" ON "QuickSelectionSong"("songVersionId");

-- AddForeignKey
ALTER TABLE "QuickSelectionSong" ADD CONSTRAINT "QuickSelectionSong_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickSelectionSong" ADD CONSTRAINT "QuickSelectionSong_songVersionId_fkey" FOREIGN KEY ("songVersionId") REFERENCES "SongVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

