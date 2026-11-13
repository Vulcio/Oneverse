-- The section each pass of the song's words sent with a separation sings (issue #450).
ALTER TABLE "StemSeparation" ADD COLUMN "lyricsPasses" TEXT[] DEFAULT ARRAY[]::TEXT[];
