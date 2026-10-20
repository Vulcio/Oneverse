-- A recording's beats and bars (issue #299), from the stem separation's analysis.
ALTER TABLE "Attachment" ADD COLUMN     "recordingBeats" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
ADD COLUMN     "recordingDownbeats" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[];
