// Song import fills in the metadata (issue #352): a chosen match looked up
// again with everything its sources know (Deezer's tempo, the length), for
// the review; linking it keeps the song's own image when asked; a bulk
// import fills only what its song doesn't have, from a match with the same
// title and artist, in the Worker. And songs linked to MusicBrainz the old
// way (issue #116): their song info saved by a backfill, showing one never
// asks MusicBrainz.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { FAKE_PROVIDERS_URL, musicBrainzHits, startFakeProviders } from "../lib/fake-providers.mjs";

const fake = await startFakeProviders();
const owner = await user("Importer");
const admin = await user("Admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await api(admin, "DELETE", "/admin/metadata");
const wait = async (test, tries = 80) => {
  for (let i = 0; i < tries; i++) {
    const value = await test();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
};

const title = `Oceans ${stamp}`;
const { matches } = await api(owner, "GET", `/metadata/search?${new URLSearchParams({ title, artist: "Hillsong" })}`);
const [first] = matches;

// --- the review's lookup
let r = await call(owner, "POST", "/metadata/lookup", { sources: first.sources.map(({ provider, id }) => ({ provider, id })) });
check("a match looked up again for its review", r.status === 200 && r.body.album === "Album 1" && r.body.sources.length === 3, `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
check("with Deezer's tempo and the length", r.body.tempo === 124.2 && r.body.durationSeconds === 253, `${r.body.tempo} ${r.body.durationSeconds}`);
check("and Deezer's ISRC", r.body.isrc === "AUDZR1300001", String(r.body.isrc));
check("signed in only", (await call({ bearer: "" }, "POST", "/metadata/lookup", { sources: [{ provider: "deezer", id: "5001" }] })).status === 401);
check("no unknown field", (await call(owner, "POST", "/metadata/lookup", { sources: [{ provider: "deezer", id: "5001" }], artwork: true })).status === 400);

// --- linking without the artwork: the song's own image stays
const song = await api(owner, "POST", "/song-versions", { title, language: "en", artists: ["Hillsong"] });
await wait(() => sql(`select "imageStorageKey" from "SongVersion" where id='${song.id}'`));
await call(owner, "PUT", `/song-versions/${song.id}/artwork`, { url: `${FAKE_PROVIDERS_URL}/art/2/800x800bb.png` });
r = await call(owner, "POST", `/song-versions/${song.id}/metadata-link`, { sources: first.sources.map(({ provider, id }) => ({ provider, id })), artwork: false });
check("linked", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
check("its own image kept", sql(`select "imageSourceUrl" from "SongVersion" where id='${song.id}'`) === `${FAKE_PROVIDERS_URL}/art/2/800x800bb.png`);
r = await call(owner, "POST", `/song-versions/${song.id}/metadata-link`, { sources: first.sources.map(({ provider, id }) => ({ provider, id })) });
check("left out, the match's artwork is used, as before", sql(`select "imageSourceUrl" from "SongVersion" where id='${song.id}'`) === `${FAKE_PROVIDERS_URL}/art/0/800x800bb.png`);

// --- a bulk import fills what's empty
const songbook = await api(owner, "POST", "/songbooks", { name: `Imports ${stamp}`, kind: "NUMBERED", abbreviation: "IM" });
const filled = await api(owner, "POST", "/song-versions", { title: `Cornerstone ${stamp}`, language: "en", artists: ["Hillsong"], album: "My own album" });
const bare = await api(owner, "POST", "/song-versions", { title: `Nomatch hymn ${stamp}`, language: "en", artists: ["Hillsong"] });
await api(owner, "POST", `/songbooks/${songbook.id}/entries`, { songVersionId: filled.id, entryCode: "1" });
await api(owner, "POST", `/songbooks/${songbook.id}/entries`, { songVersionId: bare.id, entryCode: "2" });
const form = new FormData();
form.append("type", "CHORDPRO");
form.append("files", new Blob([`{t: Cornerstone ${stamp}}\n[G]My hope is built ${stamp}`], { type: "text/plain" }), "1.cho");
form.append("files", new Blob([`{t: Nomatch hymn ${stamp}}\n[C]Holy ${stamp}`], { type: "text/plain" }), "2.cho");
const res = await fetch(`${API}/songbooks/${songbook.id}/bulk-upload`, { method: "POST", headers: { Authorization: `Bearer ${owner.bearer}` }, body: form });
check("bulk upload queued", res.status === 201, String(res.status));
const linked = await wait(async () => (await api(owner, "GET", `/song-versions/${filled.id}/metadata`)) ?? null);
check("the song with an artist is linked to its match", linked?.title === `Cornerstone ${stamp}`, JSON.stringify(linked));
const after = await api(owner, "GET", `/song-versions/${filled.id}`);
check("its empty fields filled: year, ISRC, tempo, length", after.year === 2013 && after.isrc === "AUDZR1300001" && after.documentJson.defaults.tempo === 124 && after.documentJson.defaults.durationSeconds === 253, `${after.year} ${after.isrc} ${JSON.stringify(after.documentJson.defaults)}`);
check("what it had stays: the album", after.album === "My own album", after.album);
check("its chart is the file's", JSON.stringify(after.documentJson).includes(`built ${stamp}`));
const history = await api(owner, "GET", `/song-versions/${filled.id}/history`);
check("what was filled is in its history, under the importer's name", JSON.stringify(history).includes(owner.id) || JSON.stringify(history).includes("Importer"), JSON.stringify(history).slice(0, 300));
const jobDone = await wait(async () => (await api(admin, "GET", "/admin/jobs")).recent.find((job) => job.queue === "song-info" && job.result?.outcome === "no-close-match"));
check("a song with no match that close is left alone", !!jobDone && (await api(owner, "GET", `/song-versions/${bare.id}/metadata`)) == null && (await api(owner, "GET", `/song-versions/${bare.id}`)).year == null, JSON.stringify(jobDone));

// --- songs linked to MusicBrainz the old way (issue #116)
const old = await api(owner, "POST", "/song-versions", { title: `Old link ${stamp}`, language: "en", artists: ["Hillsong"] });
const known = first.sources.find((source) => source.provider === "musicbrainz").id;
sql(`insert into "SongVersionIdentifier" (id, "songVersionId", type, value, "sourceUrl", "updatedAt") values ('legacy${stamp}', '${old.id}', 'MUSICBRAINZ_RECORDING', '${known}', 'https://musicbrainz.org/recording/${known}', now())`);
const before = musicBrainzHits.recordings;
r = await call(owner, "GET", `/song-versions/${old.id}/metadata`);
check("shown before the backfill: nothing yet, and MusicBrainz isn't asked", r.status === 200 && r.body == null && musicBrainzHits.recordings === before, `${r.status} ${JSON.stringify(r.body)} ${musicBrainzHits.recordings - before}`);
check("admins only start it", (await call(owner, "POST", "/admin/metadata-matches/backfill")).status === 403);
const queued = await api(admin, "POST", "/admin/metadata-matches/backfill");
check("the backfill queued", !!queued.jobId, JSON.stringify(queued));
const saved = await wait(async () => (await api(owner, "GET", `/song-versions/${old.id}/metadata`)) ?? null);
check("its song info saved from MusicBrainz, once", saved?.sources?.[0]?.id === known && saved.sources[0].provider === "musicbrainz", JSON.stringify(saved));
const hits = musicBrainzHits.recordings;
await api(owner, "GET", `/song-versions/${old.id}/metadata`);
check("shown again: no MusicBrainz call", musicBrainzHits.recordings === hits);

fake.close();
finish();
