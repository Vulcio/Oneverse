-- Tables nothing writes (issue #347): word tags, song share links, import jobs, and the upstream links of songs
-- published as copies before #73 (each folded into its catalogue song at startup since #75). Kept: MIDI, grooves,
-- tunings, ink and chord voicings, for the features they're planned for.

-- A copy not folded yet would lose its link to the catalogue song: stop, so the previous release can fold it
-- (POST /admin/fold-copies) before this one is deployed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "UpstreamLink" link
    JOIN "SongVersion" local ON local.id = link."localVersionId"
    JOIN "SongVersion" upstream ON upstream.id = link."globalVersionId"
    WHERE local."ownerScope" <> 'GLOBAL' AND upstream."ownerScope" = 'GLOBAL'
  ) THEN
    RAISE EXCEPTION 'Songs published as copies are still waiting to be folded: run the previous release (it folds them at startup, or POST /admin/fold-copies), then deploy this one.';
  END IF;
END $$;

DROP TABLE "ImportJob";
DROP TABLE "ShareLink";
DROP TABLE "UpstreamLink";
DROP TABLE "WorkTag";
DROP TYPE "ImportFormat";
