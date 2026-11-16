-- How many hours YouVersion passages are kept (issue #485): null, YOUVERSION_CACHE_HOURS (else never).
ALTER TABLE "ScriptureSettings" ADD COLUMN "youversionCacheHours" INTEGER;
