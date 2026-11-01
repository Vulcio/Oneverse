// A catalogue's links and what's in your library (issue #210): the Links
// column and each service's own read together, an address on another site
// refused with its row, written back on export; an entry's translations;
// the entries already songs in your songbooks started from the catalogue;
// and Start making the song with the links as its identifiers.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Links admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const reader = await user("Links reader");
const other = await user("Links other");
const abbr = `LK${stamp % 100000}`;
const catalog = (await call(admin, "POST", "/songbook-catalogs", { name: `Linked ${stamp}`, abbreviation: abbr })).body;
const translated = (await call(admin, "POST", "/songbook-catalogs", { name: `Translated ${stamp}`, abbreviation: `TR${stamp % 100000}` })).body;
const importInto = (target, content, extra = {}) => call(admin, "POST", `/songbook-catalogs/${target.id}/entries/import`, { content, ...extra });
const entries = async (target, who = admin) => (await call(who, "GET", `/songbook-catalogs/${target.id}`)).body.entries;

const csv = [
  "Number,Title,YouTube,Spotify,Links",
  "1,One,https://youtu.be/dQw4w9WgXcQ,https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC,https://www.deezer.com/fr/track/3135556; https://music.apple.com/us/album/x/1440833098?i=1440833530",
  "2,Two,https://example.com/two,,",
  "3,Three,,,",
].join("\n");
let r = await importInto(catalog, csv, { dryRun: true });
check(
  "an address on another site is a problem with its row",
  r.body.created === 2 && r.body.problems.length === 1 && r.body.problems[0].row === 3 && /isn't a YouTube, Spotify, Apple Music or Deezer address/.test(r.body.problems[0].message),
  JSON.stringify(r.body.problems),
);
r = await importInto(catalog, csv);
const one = (await entries(catalog)).find((entry) => entry.entryCode === "1");
check(
  "every column's addresses kept together, rebuilt from their IDs",
  JSON.stringify(one?.links) ===
    JSON.stringify([
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      "https://www.deezer.com/track/3135556",
      "https://music.apple.com/us/album/x/1440833098?i=1440833530",
    ]),
  JSON.stringify(one?.links),
);
r = await call(admin, "PATCH", `/songbook-catalogs/${catalog.id}/entries/${one.id}`, { links: "https://vimeo.com/1" });
check("an edit with another site's address is refused", r.status === 400, JSON.stringify(r.body));
const exported = await fetch(`${process.env.E2E_API_URL ?? "http://localhost:3001"}/songbook-catalogs/${catalog.id}/export?format=csv`, { headers: { Authorization: `Bearer ${admin.bearer}` } }).then((res) => res.text());
check("written back on export", exported.includes("https://www.youtube.com/watch?v=dQw4w9WgXcQ; https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"), exported.split("\n")[1]);

// Translations: another catalogue's entry, and one in the same catalogue.
await importInto(translated, `Number,Title,OriginalSong\n7,Un,${abbr} 1\n`);
await importInto(catalog, "Number,Title,OriginalSong\n4,One again,1\n");
const withTranslations = (await entries(catalog, reader)).find((entry) => entry.entryCode === "1");
check(
  "an entry lists the entries that translate it, from any catalogue",
  withTranslations.translations.map((t) => `${t.catalogAbbreviation ?? ""} ${t.entryCode}`).sort().join() === [`${abbr} 4`, `TR${stamp % 100000} 7`].sort().join(),
  JSON.stringify(withTranslations.translations),
);

// What's in the library.
r = await call(reader, "GET", `/songbooks/from-catalog/${catalog.id}`);
check("nothing yet: no songbook from it", r.status === 200 && r.body.songbooks.length === 0 && r.body.songs.length === 0, JSON.stringify(r.body));
const songbook = (await call(reader, "POST", "/songbooks/import-from-catalog", { catalogId: catalog.id })).body;
r = await call(reader, "GET", `/songbooks/from-catalog/${catalog.id}`);
check("a songbook started from it, theirs to add to", r.body.songbooks.length === 1 && r.body.songbooks[0].id === songbook.id && r.body.songbooks[0].access === "own" && r.body.songs.length === 0, JSON.stringify(r.body));

r = await call(reader, "POST", `/songbooks/${songbook.id}/catalog-entries/${one.id}/materialize`);
check("Start makes the song", r.status === 201, JSON.stringify(r.body));
const songVersionId = r.body.songVersionId;
const identifiers = sql(`select string_agg(type || '=' || value, ',' order by type::text) from "SongVersionIdentifier" where "songVersionId"='${songVersionId}'`);
check("its links became the song's", identifiers === "APPLE_MUSIC=1440833530,DEEZER=3135556,SPOTIFY=4uLU6hMCjMI75M1A2tKUQC,YOUTUBE=dQw4w9WgXcQ", identifiers);

r = await call(reader, "GET", `/songbooks/from-catalog/${catalog.id}`);
check(
  "the entry is marked as in the songbook, with its song",
  r.body.songs.length === 1 && r.body.songs[0].catalogEntryId === one.id && r.body.songs[0].songVersionId === songVersionId && r.body.songs[0].songbookName === songbook.name,
  JSON.stringify(r.body.songs),
);
r = await call(other, "GET", `/songbooks/from-catalog/${catalog.id}`);
check("someone else's songbooks aren't theirs", r.body.songbooks.length === 0 && r.body.songs.length === 0, JSON.stringify(r.body));

finish();
