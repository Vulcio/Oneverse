-- Entry numbers without leading zeros (issue #55): a plain number is stored
-- as "245", not "0245" - as the app now saves it (normalizeEntryCode in
-- @oneverse/core). Codes with letters ("A-17", "FR-092") stay as printed.
--
-- An entry is left as it is when another in the same songbook (or catalogue)
-- would end up with the same number ("042" beside "42", or "042" beside
-- "0042"): the unique number per book must hold, and search matches both
-- anyway.

UPDATE "SongbookEntry" AS e
SET "entryCode" = regexp_replace(e."entryCode", '^0+([0-9])', '\1')
WHERE e."entryCode" ~ '^0[0-9]+$'
  AND NOT EXISTS (
    SELECT 1 FROM "SongbookEntry" AS o
    WHERE o."songbookId" = e."songbookId"
      AND o.id <> e.id
      AND o."entryCode" ~ '^[0-9]+$'
      AND regexp_replace(o."entryCode", '^0+([0-9])', '\1') = regexp_replace(e."entryCode", '^0+([0-9])', '\1')
  );

UPDATE "SongbookCatalogEntry" AS e
SET "entryCode" = regexp_replace(e."entryCode", '^0+([0-9])', '\1')
WHERE e."entryCode" ~ '^0[0-9]+$'
  AND NOT EXISTS (
    SELECT 1 FROM "SongbookCatalogEntry" AS o
    WHERE o."catalogId" = e."catalogId"
      AND o.id <> e.id
      AND o."entryCode" ~ '^[0-9]+$'
      AND regexp_replace(o."entryCode", '^0+([0-9])', '\1') = regexp_replace(e."entryCode", '^0+([0-9])', '\1')
  );
