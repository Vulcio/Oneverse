-- A set's items have a kind (issue #305): songs, and slides of text.
CREATE TYPE "SetlistItemKind" AS ENUM ('SONG', 'TEXT');

ALTER TABLE "SetlistItem" ADD COLUMN "kind" "SetlistItemKind" NOT NULL DEFAULT 'SONG',
ADD COLUMN "text" JSONB,
ALTER COLUMN "songVersionId" DROP NOT NULL;

-- A song has its song, a text its text.
ALTER TABLE "SetlistItem" ADD CONSTRAINT "SetlistItem_kind_fields" CHECK (("kind" = 'SONG' AND "songVersionId" IS NOT NULL) OR ("kind" = 'TEXT' AND "songVersionId" IS NULL AND "text" IS NOT NULL));
