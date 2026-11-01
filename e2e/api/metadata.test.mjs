// Metadata providers (issue #22): Auto detect's search across MusicBrainz,
// Apple Music and Deezer (stand-ins, see lib/fake-providers.mjs), merged
// and ranked - the closest match first, then the song's first release,
// then the admin's order; a provider that fails left out; the admin's
// settings; linking a match brings its streaming links and artwork.
import { api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { FAKE_PROVIDERS_URL, startFakeProviders } from "../lib/fake-providers.mjs";

const fake = await startFakeProviders();
const owner = await user("Seeker");
const stranger = await user("Stranger");
const admin = await user("Admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await api(admin, "DELETE", "/admin/metadata");

const title = `Oceans ${stamp}`;
const search = (who, t = title, artist = "Hillsong") => call(who, "GET", `/metadata/search?${new URLSearchParams({ title: t, artist })}`);
const describe = (match) => `${match.album} ${match.releaseDate} [${match.sources.map((s) => s.provider).join(",")}]`;

// --- one search, merged and ranked
let r = await search(owner);
check("searched", r.status === 200 && r.body.matches.length > 0 && r.body.unavailable.length === 0, `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
let { matches } = r.body;
const [first] = matches;
check(
  "the same release from the three providers is one match",
  first.sources.map((s) => s.provider).join() === "musicbrainz,apple_music,deezer",
  matches.map(describe).join(" | "),
);
check("with its first release: the album it came out on, not the compilation MusicBrainz lists first", first.album === "Album 1" && first.releaseDate === "2013-02-22", describe(first));
check("and artwork, from Apple Music", first.artworkUrl === `${FAKE_PROVIDERS_URL}/art/0/800x800bb.png` && !!first.thumbnailUrl, first.artworkUrl);
const albums = matches.map((m) => `${m.title === title ? "" : "~"}${m.artist === "Hillsong" ? "" : "!"}${m.album}`);
check("then later releases, oldest first", albums.slice(0, 4).join() === "Album 1,Album 2,Album 3,Live 2020", albums.join());
check("the karaoke version after the song, though older", albums.indexOf("~Sing Along") === 4, albums.join());
check("another band's song with that title last", albums.at(-1) === "!Old Songs", albums.join());
check("someone signed out can't search", (await call({ bearer: "" }, "GET", `/metadata/search?title=x`)).status === 401);

// --- a provider that fails is left out, not the search
r = await search(owner, `Deezerdown ${stamp}`);
check("Deezer down: the others' matches, and Deezer named", r.status === 200 && r.body.unavailable.join() === "deezer" && r.body.matches.length > 0 && !r.body.matches.some((m) => m.sources.some((s) => s.provider === "deezer")), JSON.stringify(r.body.unavailable));

// --- the admin's settings (a list saved with issue #22's `enabled` is song info, issue #89)
let settings = await api(admin, "GET", "/admin/metadata");
const songInfo = (list) => list.providers.map((p) => `${p.key}:${p.capabilities.songInfo}`).join();
check("all of them, in the default order", settings.source === "default" && songInfo(settings) === "musicbrainz:true,apple_music:true,deezer:true,spotify:true,song_providers:true", JSON.stringify(settings));
check("Spotify can't be asked without its app", settings.providers.find((p) => p.key === "spotify").ready.songInfo === false);
check("admins only", (await call(owner, "GET", "/admin/metadata")).status === 403 && (await call(owner, "PUT", "/admin/metadata", { providers: [] })).status === 403);
check("no unknown provider", (await call(admin, "PUT", "/admin/metadata", { providers: [{ key: "napster", enabled: true }] })).status === 400);
settings = await api(admin, "PUT", "/admin/metadata", { providers: [{ key: "deezer", enabled: true }, { key: "musicbrainz", enabled: false }] });
check("saved: Deezer first, MusicBrainz off, those left out added off", settings.source === "database" && songInfo(settings) === "deezer:true,musicbrainz:false,apple_music:false,spotify:false,song_providers:false", JSON.stringify(settings));
({ matches } = (await search(owner)).body);
check("only Deezer asked", matches.length > 0 && matches.every((m) => m.sources.every((s) => s.provider === "deezer")), matches.map(describe).join(" | "));
settings = await api(admin, "PUT", "/admin/metadata", { providers: [{ key: "deezer", enabled: true }, { key: "apple_music", enabled: true }, { key: "musicbrainz", enabled: true }] });
({ matches } = (await search(owner)).body);
check("the first provider's details, its order among the sources", matches[0].sources.map((s) => s.provider).join() === "deezer,apple_music,musicbrainz" && matches[0].artworkUrl.includes("/art/2/"), describe(matches[0]));
await api(admin, "PUT", "/admin/metadata", { providers: ["musicbrainz", "apple_music", "deezer"].map((key) => ({ key, enabled: false })) });
check("all off: nothing to search", (await search(owner)).status === 503);
settings = await api(admin, "DELETE", "/admin/metadata");
check("back to the defaults", settings.source === "default" && settings.providers.every((p) => p.capabilities.songInfo));

// --- linking a match
const song = await api(owner, "POST", "/song-versions", { title, language: "en", artists: ["Hillsong"] });
await api(owner, "PUT", `/song-versions/${song.id}/links/APPLE_MUSIC`, { url: "https://music.apple.com/us/album/mine/1?i=42" });
// An image of its own before: the match's artwork replaces it.
for (let i = 0; i < 40 && !sql(`select "imageStorageKey" from "SongVersion" where id='${song.id}'`); i++) await new Promise((resolve) => setTimeout(resolve, 250));
await call(owner, "PUT", `/song-versions/${song.id}/artwork`, { url: `${FAKE_PROVIDERS_URL}/art/2/800x800bb.png` });
({ matches } = (await search(owner)).body);
check("someone who can't edit it can't link it", (await call(stranger, "POST", `/song-versions/${song.id}/metadata-link`, { sources: matches[0].sources })).status === 403);
r = await call(owner, "POST", `/song-versions/${song.id}/metadata-link`, { sources: matches[0].sources.map(({ provider, id }) => ({ provider, id })) });
check("linked, looked up again from its three sources", r.status === 201 && r.body.sources.length === 3 && r.body.album === "Album 1" && r.body.releaseDate === "2013-02-22", `${r.status} ${JSON.stringify(r.body)}`);
const linked = await api(owner, "GET", `/song-versions/${song.id}/metadata`);
check("kept with the song", linked?.album === "Album 1" && linked.sources.map((s) => s.provider).join() === "musicbrainz,apple_music,deezer", JSON.stringify(linked));
const detail = await api(owner, "GET", `/song-versions/${song.id}`);
const link = (type) => detail.identifiers.find((identifier) => identifier.type === type);
check("its Deezer track is the song's Deezer link", link("DEEZER")?.value === "5001" && link("DEEZER").sourceUrl === "https://www.deezer.com/track/5001", JSON.stringify(detail.identifiers));
check("the Apple Music link it had stays", link("APPLE_MUSIC")?.value === "42", JSON.stringify(link("APPLE_MUSIC")));
check("its MusicBrainz recording is kept too", sql(`select value from "SongVersionIdentifier" where "songVersionId"='${song.id}' and type='MUSICBRAINZ_RECORDING'`) === matches[0].sources[0].id);
check("the release's artwork is the song's image", sql(`select "imageSourceUrl" from "SongVersion" where id='${song.id}'`) === `${FAKE_PROVIDERS_URL}/art/0/800x800bb.png`);
check("no second copy of its artist", detail.artists.filter((a) => a.source === "Hillsong").length === 1, JSON.stringify(detail.artists));

r = await call(owner, "POST", `/song-versions/${song.id}/metadata-link`, { sources: [{ provider: "deezer", id: "999999" }] });
check("a match that's gone can't be linked", r.status === 404, `${r.status} ${JSON.stringify(r.body)}`);
r = await call(owner, "POST", `/song-versions/${song.id}/metadata-link`, { sources: [{ provider: "napster", id: "1" }] });
check("nor from an unknown provider", r.status === 400, String(r.status));

// Another match, from Deezer alone: no MusicBrainz recording any more.
r = await call(owner, "POST", `/song-versions/${song.id}/metadata-link`, { sources: [{ provider: "deezer", id: "5002" }] });
check("relinked to the live album", r.status === 201 && (await api(owner, "GET", `/song-versions/${song.id}/metadata`)).album === "Live 2020");
check("its MusicBrainz recording gone", sql(`select count(*) from "SongVersionIdentifier" where "songVersionId"='${song.id}' and type='MUSICBRAINZ_RECORDING'`) === "0");

r = await call(owner, "DELETE", `/song-versions/${song.id}/metadata-link`);
check("unlinked", r.status === 204 && (await api(owner, "GET", `/song-versions/${song.id}/metadata`)) == null);
const after = await api(owner, "GET", `/song-versions/${song.id}`);
check("its streaming links and image stay", after.identifiers.some((i) => i.type === "DEEZER") && !!after.imageUrl);

fake.close();
finish();
