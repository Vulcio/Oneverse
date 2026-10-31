-- The library's sorts (issue #341): a page read in order from an index, not every song sorted.
CREATE INDEX "SongVersion_updatedAt_idx" ON "SongVersion"("updatedAt");
CREATE INDEX "SongVersion_createdAt_idx" ON "SongVersion"("createdAt");
CREATE INDEX "SongVersion_title_sort_idx" ON "SongVersion"("title");
