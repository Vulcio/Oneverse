-- How sure the analysis was, and what it nearly picked (issue #452).
ALTER TABLE "Attachment" ADD COLUMN "recordingAnalysis" JSONB;

-- The recording analysed again with what someone said of it (issue #452).
ALTER TABLE "StemSeparation" ADD COLUMN "analysisOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StemSeparation" ADD COLUMN "hints" JSONB;
