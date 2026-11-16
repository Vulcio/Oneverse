-- YouVersion passages are kept as long as its Cache-Control allows (issue #485),
-- so a number of hours is no longer asked: only whether to keep them at all.
-- null: YOUVERSION_CACHE, else yes. An admin who chose 0 hours keeps them off.
ALTER TABLE "ScriptureSettings" ADD COLUMN "youversionCache" BOOLEAN;
UPDATE "ScriptureSettings" SET "youversionCache" = false WHERE "youversionCacheHours" = 0;
ALTER TABLE "ScriptureSettings" DROP COLUMN "youversionCacheHours";
