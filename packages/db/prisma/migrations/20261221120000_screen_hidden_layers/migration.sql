-- A screen's own layers it never shows (issue #287).
ALTER TABLE "Screen" ADD COLUMN "hiddenLayers" TEXT[] DEFAULT ARRAY[]::TEXT[];
