-- YouVersion versions an admin allows on screens (issue #310).
ALTER TABLE "ScriptureSettings" ADD COLUMN "youversionProjection" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
