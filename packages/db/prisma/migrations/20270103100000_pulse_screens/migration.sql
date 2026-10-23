-- Oneverse Pulse paired like a screen, and screens following a location (issue #320).
-- CreateEnum
CREATE TYPE "ScreenKind" AS ENUM ('SCREEN', 'PULSE');

-- AlterEnum
ALTER TYPE "ScreenSetMode" ADD VALUE 'LOCATION';

-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "kind" "ScreenKind" NOT NULL DEFAULT 'SCREEN',
ADD COLUMN     "locationId" TEXT;

-- AddForeignKey
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateIndex
CREATE INDEX "Screen_locationId_idx" ON "Screen"("locationId");
