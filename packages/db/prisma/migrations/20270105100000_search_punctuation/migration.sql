-- Search ignoring punctuation (issue #328): "eternel fais moi" finds
-- "Éternel ! Fais-moi connaître", "saint saint" finds "Saint, saint". The
-- song's searchText is folded by search_fold() - accents as before (#56),
-- apostrophes left out, punctuation and hyphens a space, spaces run
-- together - and the API folds the query with the same function. The
-- characters are @oneverse/core's foldSearchWords() ones, for offline search.
CREATE FUNCTION search_fold(text TEXT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT btrim(regexp_replace(regexp_replace(unaccent(text), '[''’‘ʼ`´]', '', 'g'),
    '[[:space:]!"#$%&()*+,./:;<=>?@\[\\\]^_{|}~«»“”„‟‹›¡¿…‐‑‒–—―·•-]+', ' ', 'g'))
$$;

-- A song's search text, as before (titles, version name, performers), folded so.
CREATE OR REPLACE FUNCTION song_version_search_text(song_id TEXT, title TEXT, alternate_title TEXT, version_name TEXT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT search_fold(concat_ws(' ', title, alternate_title, version_name,
    (SELECT string_agg(vc.source, ' ' ORDER BY vc."displayOrder", vc.id)
       FROM "VersionContributor" vc
      WHERE vc."songVersionId" = song_id
        AND vc.roles @> ARRAY['PERFORMER']::"ContributorRole"[]
        AND vc.source IS NOT NULL)))
$$;

UPDATE "SongVersion" sv SET "searchText" = song_version_search_text(sv.id, sv.title, sv."alternateTitle", sv."versionName");
