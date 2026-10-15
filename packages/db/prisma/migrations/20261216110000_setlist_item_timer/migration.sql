-- A set item's own timer (issue #269), started on the screens' stage when Live comes to it.
ALTER TABLE "SetlistItem" ADD COLUMN "timer" JSONB;
