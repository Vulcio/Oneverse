-- A template's parts (issue #281): content themes, background themes and effects, saved on their own; templates refer to them; a screen's effects switch.
-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "effects" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ScreenTheme" ADD COLUMN     "backgroundBuiltIn" TEXT,
ADD COLUMN     "backgroundPartId" TEXT,
ADD COLUMN     "contentBuiltIn" TEXT,
ADD COLUMN     "contentPartId" TEXT,
ADD COLUMN     "effectsBuiltIn" TEXT,
ADD COLUMN     "effectsPartId" TEXT;

-- AlterTable
ALTER TABLE "ScreenThemeAsset" ADD COLUMN     "partId" TEXT,
ALTER COLUMN "themeId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ScreenPart" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "ownerUserId" TEXT,
    "ownerTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenPart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScreenPart_ownerUserId_idx" ON "ScreenPart"("ownerUserId");

-- CreateIndex
CREATE INDEX "ScreenPart_ownerTeamId_idx" ON "ScreenPart"("ownerTeamId");

-- CreateIndex
CREATE INDEX "ScreenTheme_contentPartId_idx" ON "ScreenTheme"("contentPartId");

-- CreateIndex
CREATE INDEX "ScreenTheme_backgroundPartId_idx" ON "ScreenTheme"("backgroundPartId");

-- CreateIndex
CREATE INDEX "ScreenTheme_effectsPartId_idx" ON "ScreenTheme"("effectsPartId");

-- CreateIndex
CREATE INDEX "ScreenThemeAsset_partId_idx" ON "ScreenThemeAsset"("partId");

-- AddForeignKey
ALTER TABLE "ScreenTheme" ADD CONSTRAINT "ScreenTheme_contentPartId_fkey" FOREIGN KEY ("contentPartId") REFERENCES "ScreenPart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenTheme" ADD CONSTRAINT "ScreenTheme_backgroundPartId_fkey" FOREIGN KEY ("backgroundPartId") REFERENCES "ScreenPart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenTheme" ADD CONSTRAINT "ScreenTheme_effectsPartId_fkey" FOREIGN KEY ("effectsPartId") REFERENCES "ScreenPart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenPart" ADD CONSTRAINT "ScreenPart_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenPart" ADD CONSTRAINT "ScreenPart_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenThemeAsset" ADD CONSTRAINT "ScreenThemeAsset_partId_fkey" FOREIGN KEY ("partId") REFERENCES "ScreenPart"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A screen that showed the chart with a built-in look or none: the built-in chord chart template, which is the
-- chart now (a template is built for one use). One with a saved theme keeps showing the chart until it's given
-- another template.
UPDATE "Screen" SET "themeTemplate" = 'band-chart', "mode" = 'LYRICS' WHERE "mode" = 'CHART' AND "themeId" IS NULL;
