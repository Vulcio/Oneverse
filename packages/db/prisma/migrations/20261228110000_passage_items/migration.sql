-- A set's items can be Bible passages (issue #301): a Bible and a reference, never the text.
ALTER TYPE "SetlistItemKind" ADD VALUE 'PASSAGE';

ALTER TABLE "SetlistItem" ADD COLUMN "passage" JSONB;

-- A song has its song, a text its text, a passage its passage.
ALTER TABLE "SetlistItem" DROP CONSTRAINT "SetlistItem_kind_fields";
ALTER TABLE "SetlistItem" ADD CONSTRAINT "SetlistItem_kind_fields" CHECK (
  ("kind" = 'SONG' AND "songVersionId" IS NOT NULL)
  OR ("kind" = 'TEXT' AND "songVersionId" IS NULL AND "text" IS NOT NULL)
  OR ("kind"::text = 'PASSAGE' AND "songVersionId" IS NULL AND "passage" IS NOT NULL)
);
