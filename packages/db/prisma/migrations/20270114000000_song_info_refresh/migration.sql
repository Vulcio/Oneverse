-- A songbook's songs looked up again at the metadata providers (issue #353).
-- CreateTable
CREATE TABLE "SongInfoRefresh" (
    "id" TEXT NOT NULL,
    "songbookId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SongInfoRefresh_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SongInfoRefresh_songbookId_createdAt_idx" ON "SongInfoRefresh"("songbookId", "createdAt");

-- AddForeignKey
ALTER TABLE "SongInfoRefresh" ADD CONSTRAINT "SongInfoRefresh_songbookId_fkey" FOREIGN KEY ("songbookId") REFERENCES "Songbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongInfoRefresh" ADD CONSTRAINT "SongInfoRefresh_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
