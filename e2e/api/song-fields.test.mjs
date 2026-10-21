// API-level checks for song fields, required artists and full catalogue carry-over.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const song = async (who, title, extra = {}) => (await call(who, "POST", "/song-versions", { title, language: "en", artists: ["Test Artist"], ...extra })).body;
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);


const admin = await user("admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);

// --- creating requires an artist
let r = await call(admin, "POST", "/song-versions", { title: `No artist ${stamp}`, language: "en" });
check("creating a song without an artist is refused", r.status === 400, JSON.stringify(r.body?.message));
r = await call(admin, "POST", "/song-versions", { title: `Blank artist ${stamp}`, language: "en", artists: ["  "] });
check("...including blank names", r.status === 400 && /at least one artist/.test(JSON.stringify(r.body.message)));
r = await call(admin, "POST", "/song-versions", { title: `Two artists ${stamp}`, language: "en", artists: ["Hillsong Worship", "Brooke Ligertwood", "hillsong worship"] });
const s1 = r.body;
check("a song can have several artists (repeats merged)", r.status === 201 && s1.artists.map((a) => a.source).join("|") === "Hillsong Worship|Brooke Ligertwood", JSON.stringify(s1.artists));

// --- every field, set and cleared
r = await call(admin, "PATCH", `/song-versions/${s1.id}`, {
  alternateTitle: "Subtitle here", sortTitle: "Two artists", album: "Live 2024", year: 2019, copyright: "© 2019 Hillsong", copyrightYear: 2019,
  ccli: "7138219", isrc: "us-rc1-76-07839", reference: "Psalm 23", notes: "Capo 2\nsoft intro", key: "A", tempo: 72, timeSignature: "6/8", durationSeconds: 245,
});
let d = r.body;
check(
  "every field saves, each on its own",
  r.status === 200 && d.alternateTitle === "Subtitle here" && d.sortTitle === "Two artists" && d.album === "Live 2024" && d.year === 2019 && d.copyright === "© 2019 Hillsong" &&
    d.copyrightYear === 2019 && d.ccli === "7138219" && d.isrc === "USRC17607839" && d.reference === "Psalm 23" && d.notes === "Capo 2\nsoft intro" &&
    d.documentJson.defaults.key === "A" && d.documentJson.defaults.tempo === 72 && d.documentJson.defaults.timeSignature?.numerator === 6 && d.documentJson.defaults.durationSeconds === 245,
  JSON.stringify(r.body).slice(0, 400),
);
r = await call(admin, "GET", `/song-versions/${s1.id}`);
check("...and reads back", r.body.isrc === "USRC17607839" && r.body.year === 2019 && r.body.notes === "Capo 2\nsoft intro");
r = await call(admin, "PATCH", `/song-versions/${s1.id}`, { album: null, year: null, isrc: "", reference: "", timeSignature: null, durationSeconds: null, key: null, tempo: null, alternateTitle: "" });
d = r.body;
check(
  "fields can be cleared (null or empty)",
  r.status === 200 && d.album === null && d.year === null && d.isrc === null && d.reference === null && d.alternateTitle === null &&
    !d.documentJson.defaults.timeSignature && !d.documentJson.defaults.durationSeconds && !d.documentJson.defaults.key && !d.documentJson.defaults.tempo && d.sortTitle === "Two artists",
  JSON.stringify(d.documentJson.defaults),
);
for (const [field, value, pattern] of [
  ["isrc", "ABC", /ISRC must be 12 characters/],
  ["timeSignature", "four", /timeSignature must be like 4\/4/],
  ["year", 99, /year must not be less than 1000/],
  ["tempo", 5, /tempo must not be less than 20/],
  ["durationSeconds", 0, /durationSeconds must not be less than 1/],
]) {
  r = await call(admin, "PATCH", `/song-versions/${s1.id}`, { [field]: value });
  check(`invalid ${field} is refused`, r.status === 400 && pattern.test(JSON.stringify(r.body.message)), JSON.stringify(r.body.message));
}
r = await call(admin, "PATCH", `/song-versions/${s1.id}`, { title: "" });
check("the title can't be cleared", r.status === 400);

// --- requests are checked against @oneverse/core's schemas (issue #118)
const titleBefore = (await call(admin, "GET", `/song-versions/${s1.id}`)).body.title;
r = await call(admin, "PATCH", `/song-versions/${s1.id}`, { colour: "red" });
check("a field the API doesn't know is refused, by name", r.status === 400 && r.body.message.includes("property colour should not exist"), JSON.stringify(r.body));
r = await call(admin, "PATCH", `/song-versions/${s1.id}`, { tempo: "fast", album: 7 });
check(
  "each problem is its own message",
  r.status === 400 && r.body.message.includes("tempo must be a number") && r.body.message.includes("album must be a string"),
  JSON.stringify(r.body.message),
);
r = await call(admin, "PATCH", `/song-versions/${s1.id}`, { title: null, isrc: " us-rc1-76-07839 " });
check("null for a field that can't be cleared leaves it alone; values are normalized", r.status === 200 && r.body.title === titleBefore && r.body.isrc === "USRC17607839", JSON.stringify({ s: r.status, t: r.body.title, i: r.body.isrc }));
r = await call(admin, "GET", "/song-versions?page=0");
check("a query is checked too", r.status === 400 && r.body.message.includes("page must not be less than 1"), JSON.stringify(r.body));
r = await call(admin, "GET", "/song-versions?pageSize=2&favorites=false");
check("and read as numbers and yes/no", r.status === 200 && r.body.items.length <= 2, String(r.status));

// --- the last artist stays
r = await call(admin, "PATCH", `/song-versions/${s1.id}`, { artists: ["Only One"] });
check("artists can be replaced while one remains", r.status === 200 && r.body.artists.length === 1, String(r.status));
r = await call(admin, "PATCH", `/song-versions/${s1.id}`, { artists: [] });
check("the last artist can't be removed", r.status === 400 && /at least one artist/.test(JSON.stringify(r.body.message)), JSON.stringify(r.body));

// --- unlinking the song info (issue #22) never strips the only artist
const solo = await song(admin, `Solo ${stamp}`);
sql(`update "VersionContributor" set "isAutoAttached"=true where "songVersionId"='${solo.id}'`);
sql(`insert into "SongVersionIdentifier" (id, "songVersionId", type, value, "updatedAt") values ('mb${stamp}', '${solo.id}', 'MUSICBRAINZ_RECORDING', '00000000-0000-0000-0000-000000000000', now())`);
r = await call(admin, "DELETE", `/song-versions/${solo.id}/metadata-link`);
const soloArtists = (await call(admin, "GET", `/song-versions/${solo.id}`)).body.artists;
check("unlinking the song info keeps a song's only artist", (r.status === 204 || r.status === 200) && soloArtists.length === 1 && soloArtists[0].source === "Test Artist", `${r.status} ${JSON.stringify(soloArtists)}`);

// --- full carry-over from a catalogue entry
const abbrEn = `EN${stamp % 100000}`;
const en = (await call(admin, "POST", "/songbook-catalogs", { name: `English ${stamp}`, abbreviation: abbrEn })).body;
await call(admin, "POST", `/songbook-catalogs/${en.id}/entries/import`, { content: "Number,Title,Artist\n12,Amazing Grace,Chris Tomlin\n" });
const fr = (await call(admin, "POST", "/songbook-catalogs", { name: `French ${stamp}`, abbreviation: `FR${stamp % 100000}`, language: "fr" })).body;
const frCsv = [
  "Number,Title,SortTitle,Subtitle,OriginalSong,Language,Artist,Composer,Lyricist,Album,Year,Key,Time,Tempo,Duration,Copyright,CCLI,ISRC,Reference,Tags,Notes",
  `7,Grâce infinie,Grace infinie,Quelle grâce,${abbrEn} 12,en,Chris Tomlin; Hillsong,John Newton; Trad.,John Newton,Worship Hits,1779,G,3/4,72,4:05,Public domain,22025,USRC17607839,Éphésiens 2:8,"PAQUES; christmas; not-a-tag",Chanter doucement`,
].join("\n");
r = await call(admin, "POST", `/songbook-catalogs/${fr.id}/entries/import`, { content: frCsv });
check("a catalogue with every column imports", r.body.created === 1 && r.body.problems.length === 0, JSON.stringify(r.body.problems));

// The original (English) becomes a song first, in a songbook from its catalogue.
const enBook = (await call(admin, "POST", "/songbooks/import-from-catalog", { catalogId: en.id })).body;
const enPending = (await call(admin, "GET", `/songbooks/${enBook.id}`)).body.pendingEntries[0];
const enSong = (await call(admin, "POST", `/songbooks/${enBook.id}/catalog-entries/${enPending.catalogEntryId ?? enPending.id}/materialize`)).body;
const frBook = (await call(admin, "POST", "/songbooks/import-from-catalog", { catalogId: fr.id })).body;
const frPending = (await call(admin, "GET", `/songbooks/${frBook.id}`)).body.pendingEntries[0];
r = await call(admin, "POST", `/songbooks/${frBook.id}/catalog-entries/${frPending.catalogEntryId ?? frPending.id}/materialize`);
const created = (await call(admin, "GET", `/song-versions/${r.body.songVersionId}`)).body;
const defaults = created.documentJson.defaults;
check(
  "the song gets every field",
  created.title === "Grâce infinie" && created.alternateTitle === "Quelle grâce" && created.sortTitle === "Grace infinie" && created.album === "Worship Hits" && created.year === 1779 &&
    created.copyright === "Public domain" && created.copyrightYear === null && created.ccli === "22025" && created.isrc === "USRC17607839" && created.reference === "Éphésiens 2:8" &&
    created.notes === "Chanter doucement" && created.language === "fr" &&
    defaults.key === "G" && defaults.tempo === 72 && defaults.timeSignature?.numerator === 3 && defaults.durationSeconds === 245,
  JSON.stringify({ ...created, documentJson: defaults }).slice(0, 600),
);
const credits = created.contributors.map((c) => `${c.source}:${[...c.roles].sort().join("+")}`).join(" | ");
check("several artists, composers and lyricists become credits, merged per person", credits === "Chris Tomlin:PERFORMER | Hillsong:PERFORMER | John Newton:COMPOSER+LYRICIST | Trad.:COMPOSER", credits);
check("tags that match existing ones are added (any language, any case); the rest are dropped", created.tags.map((t) => t.slug).sort().join() === "christmas,easter", created.tags.map((t) => t.slug).join());
check(
  "the original song becomes its parent, in the same Work, as a translation",
  created.parentVersion?.id === enSong.songVersionId && created.relationshipType === "DIRECT_TRANSLATION" && created.workId === (await call(admin, "GET", `/song-versions/${enSong.songVersionId}`)).body.workId,
  JSON.stringify({ p: created.parentVersion, r: created.relationshipType }),
);

finish();
