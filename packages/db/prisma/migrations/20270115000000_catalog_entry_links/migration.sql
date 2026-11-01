-- AlterTable
ALTER TABLE "SongbookCatalogEntry" ADD COLUMN     "links" TEXT[] DEFAULT ARRAY[]::TEXT[];
