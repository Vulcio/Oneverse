-- Notes on songs (issue #256): where a note is saved (place) decides who sees
-- it; where it's pinned (anchor) is by the chart's IDs. A set's "My notes"
-- become notes saved in "just me", only in that set, on the whole song.

CREATE TYPE "NotePlace" AS ENUM ('ME', 'TEAM', 'SONGBOOK', 'SET', 'SONG');

ALTER TABLE "Note"
ADD COLUMN "anchor" JSONB NOT NULL DEFAULT '{"kind":"song"}',
ADD COLUMN "place" "NotePlace",
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "songbookId" TEXT;

UPDATE "Note" n
SET "place" = 'ME', "songVersionId" = i."songVersionId", "setlistId" = i."setlistId"
FROM "SetlistItem" i
WHERE n."scope" = 'SETLIST_ITEM' AND n."setlistItemId" = i."id";

UPDATE "Note" SET "place" = 'ME' WHERE "scope" = 'USER';
UPDATE "Note" SET "place" = 'TEAM' WHERE "scope" = 'TEAM';

-- What can't be placed on a song (never written by the app).
DELETE FROM "Note" WHERE "place" IS NULL OR "songVersionId" IS NULL OR ("place" = 'TEAM' AND "teamId" IS NULL);

ALTER TABLE "Note" DROP CONSTRAINT "Note_arrangementId_fkey";
ALTER TABLE "Note" DROP CONSTRAINT "Note_setlistItemId_fkey";
DROP INDEX "Note_arrangementId_idx";
DROP INDEX "Note_setlistItemId_idx";

ALTER TABLE "Note" DROP COLUMN "arrangementId",
DROP COLUMN "scope",
DROP COLUMN "setlistItemId",
ALTER COLUMN "anchor" DROP DEFAULT,
ALTER COLUMN "place" SET NOT NULL,
ALTER COLUMN "songVersionId" SET NOT NULL;

DROP TYPE "NoteScope";

CREATE TABLE "NoteReply" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NoteReply_noteId_idx" ON "NoteReply"("noteId");
CREATE INDEX "NoteReply_authorUserId_idx" ON "NoteReply"("authorUserId");

ALTER TABLE "Note" ADD CONSTRAINT "Note_songbookId_fkey" FOREIGN KEY ("songbookId") REFERENCES "Songbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteReply" ADD CONSTRAINT "NoteReply_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NoteReply" ADD CONSTRAINT "NoteReply_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
