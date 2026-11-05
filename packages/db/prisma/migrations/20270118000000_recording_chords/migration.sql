-- A recording's chords as the stem separation's analysis found them (issue #393).
ALTER TABLE "Attachment" ADD COLUMN "recordingChords" JSONB;
