-- Artists with several names (issue #512): a former name or another spelling
-- is kept beside the artist, and every name leads to them. Songs keep their
-- credit as written.
CREATE TABLE "ArtistName" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "searchKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistName_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArtistName_key_key" ON "ArtistName"("key");
CREATE INDEX "ArtistName_artistId_idx" ON "ArtistName"("artistId");
CREATE INDEX "ArtistName_searchKey_idx" ON "ArtistName"("searchKey");

ALTER TABLE "ArtistName" ADD CONSTRAINT "ArtistName_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The name as the songs' searchText folds it: never written by the app.
CREATE FUNCTION artist_name_search_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchKey" := lower(search_fold(NEW.name));
  RETURN NEW;
END $$;

CREATE TRIGGER artist_name_search_key
BEFORE INSERT OR UPDATE OF name ON "ArtistName"
FOR EACH ROW EXECUTE FUNCTION artist_name_search_key();

-- A song's search text, as before (titles, version name, performers), plus
-- the other names of the artists it credits: "youthfr" finds a song credited
-- to Parfaitement Imparfait. Only artists with other names are looked at.
CREATE OR REPLACE FUNCTION song_version_search_text(song_id TEXT, title TEXT, alternate_title TEXT, version_name TEXT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  WITH credits AS (
    SELECT vc.source, vc."displayOrder", vc.id
      FROM "VersionContributor" vc
     WHERE vc."songVersionId" = song_id
       AND vc.roles @> ARRAY['PERFORMER']::"ContributorRole"[]
       AND vc.source IS NOT NULL
  ), folded AS (
    SELECT lower(search_fold(source)) AS f FROM credits
  ), artists AS (
    SELECT an."artistId" AS id FROM "ArtistName" an WHERE an."searchKey" IN (SELECT f FROM folded)
    UNION
    SELECT a.id FROM "Artist" a
     WHERE a.id IN (SELECT "artistId" FROM "ArtistName")
       AND lower(search_fold(a.name)) IN (SELECT f FROM folded)
  )
  SELECT search_fold(concat_ws(' ', title, alternate_title, version_name,
    (SELECT string_agg(source, ' ' ORDER BY "displayOrder", id) FROM credits),
    (SELECT string_agg(n, ' ' ORDER BY n) FROM (
       SELECT a.name AS n FROM "Artist" a WHERE a.id IN (SELECT id FROM artists)
       UNION
       SELECT an.name FROM "ArtistName" an WHERE an."artistId" IN (SELECT id FROM artists)
     ) names)))
$$;
