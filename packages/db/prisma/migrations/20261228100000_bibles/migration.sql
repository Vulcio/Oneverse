-- Bibles imported from files (issue #301).
CREATE TYPE "BibleStatus" AS ENUM ('IMPORTING', 'READY', 'FAILED');

CREATE TABLE "Bible" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT,
    "language" TEXT,
    "copyright" TEXT,
    "sourceFormat" TEXT,
    "status" "BibleStatus" NOT NULL DEFAULT 'IMPORTING',
    "error" TEXT,
    "sourceStorageKey" TEXT,
    "books" JSONB NOT NULL DEFAULT '[]',
    "verseCount" INTEGER NOT NULL DEFAULT 0,
    "canProject" BOOLEAN NOT NULL DEFAULT false,
    "canOffline" BOOLEAN NOT NULL DEFAULT false,
    "canExport" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Bible_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BibleVerse" (
    "bibleId" TEXT NOT NULL,
    "book" INTEGER NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    "endVerse" INTEGER,
    "text" TEXT NOT NULL,
    CONSTRAINT "BibleVerse_pkey" PRIMARY KEY ("bibleId","book","chapter","verse")
);

ALTER TABLE "BibleVerse" ADD CONSTRAINT "BibleVerse_bibleId_fkey" FOREIGN KEY ("bibleId") REFERENCES "Bible"("id") ON DELETE CASCADE ON UPDATE CASCADE;
