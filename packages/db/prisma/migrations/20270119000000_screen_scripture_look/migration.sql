-- A screen's look for Bible passages (issue #402): a saved template or a built-in one.
ALTER TABLE "Screen" ADD COLUMN "scriptureThemeId" TEXT;
ALTER TABLE "Screen" ADD COLUMN "scriptureThemeTemplate" TEXT;
CREATE INDEX "Screen_scriptureThemeId_idx" ON "Screen"("scriptureThemeId");
ALTER TABLE "Screen" ADD CONSTRAINT "Screen_scriptureThemeId_fkey" FOREIGN KEY ("scriptureThemeId") REFERENCES "ScreenTheme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
