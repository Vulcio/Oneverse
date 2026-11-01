// The built-in Song provider plugin (issue #157), against the example
// server (examples/song-provider): Admin > Plugins for admins only, off
// until turned on; a server added only once it answers the API, its key
// encrypted and never sent back, a private address refused unless it's on
// this network; Find chords - search, a ChordPro chart, and a SongDocument
// v2 turned into one; song info and artwork in Auto detect, looked up again
// and linked with the artwork downloaded from the server's own address;
// artists' pictures; the hooks chosen per server; a server that fails is
// its own failure, shown in Admin.
import { api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { FAKE_SONG_PROVIDER_KEY, startFakeSongProvider } from "../lib/fake-song-provider.mjs";

const port = Number(process.env.FAKE_SONG_PROVIDER_PORT ?? 3993);
const provider = await startFakeSongProvider({ port, apiKey: FAKE_SONG_PROVIDER_KEY, name: `Example songs ${stamp}` });
const admin = await user("Plugins admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const someone = await user("Plugin user");
const plugin = async () => (await api(admin, "GET", "/admin/plugins")).plugins.find((one) => one.id === "song-provider");

try {
  // A clean start: no servers, the plugin back to its default, Auto detect asking only the song providers.
  for (const source of (await plugin()).sources) await api(admin, "DELETE", `/admin/plugins/song-provider/sources/${source.id}`);
  await api(admin, "DELETE", "/admin/plugins/song-provider");
  await api(admin, "PUT", "/admin/metadata", { providers: [{ key: "song_providers" }] });

  check("admins only", (await call(someone, "GET", "/admin/plugins")).status === 403);
  let found = await plugin();
  check("the Song provider plugin, built in and off until turned on", found?.builtIn === true && found.enabled === false && found.provides.join() === "songInfo,artwork,artistPictures,chords", JSON.stringify(found));
  check("Find chords has nowhere to look", (await api(someone, "GET", "/plugins/chords")).available === false);

  // Adding a server.
  let r = await call(admin, "POST", "/admin/plugins/song-provider/sources", { apiUrl: provider.url, apiKey: FAKE_SONG_PROVIDER_KEY });
  check("a private address refused unless it's on this network", r.status === 400 && /https:\/\/|private or local/.test(r.body.message.join()), JSON.stringify(r.body));
  r = await call(admin, "POST", "/admin/plugins/song-provider/sources", { apiUrl: provider.url, apiKey: "wrong", allowPrivate: true });
  check("a wrong key: not added, and said", r.status === 400 && /refused the key/.test(r.body.message.join()), JSON.stringify(r.body));
  r = await call(admin, "POST", "/admin/plugins/song-provider/sources", { apiUrl: `${provider.url}/v1/`, apiKey: FAKE_SONG_PROVIDER_KEY, allowPrivate: true });
  const source = r.body.plugins?.find((one) => one.id === "song-provider")?.sources[0];
  check(
    "added once it answers: its own name, everything it answers chosen, the key kept but never sent back",
    r.status === 201 && source?.name === `Example songs ${stamp}` && source.hooks.join() === "songInfo,artwork,artistPictures,chords" && source.hasApiKey === true && !JSON.stringify(r.body).includes(FAKE_SONG_PROVIDER_KEY),
    JSON.stringify(r.body),
  );
  check("the key encrypted at rest", !sql(`select "apiKeyEnc" from "SongProviderSource" where id='${source.id}'`).includes(FAKE_SONG_PROVIDER_KEY));
  check("asked with the key, as a Bearer token", provider.requests.some((req) => req.path === "/v1/capabilities" && req.authorization === `Bearer ${FAKE_SONG_PROVIDER_KEY}`));
  check("still nothing while the plugin is off", (await api(someone, "GET", "/plugins/chords")).available === false);

  await api(admin, "PUT", "/admin/plugins/song-provider", { enabled: true });
  found = await plugin();
  check("turned on, from Admin", found.enabled === true && found.source === "database");
  r = await call(someone, "GET", "/plugins/chords");
  check("Find chords offered, naming where it looks", r.body.available === true && r.body.providers.includes(`Example songs ${stamp}`), JSON.stringify(r.body));

  // Find chords.
  r = await call(someone, "GET", `/plugins/chords/search?${new URLSearchParams({ title: "grace" })}`);
  check(
    "searched: the songs with chords, not those without",
    r.status === 200 && r.body.results.length === 1 && r.body.results[0].title === "Amazing Grace" && r.body.results[0].providerId === source.id && r.body.unavailable.length === 0,
    JSON.stringify(r.body),
  );
  check("the search sent what the API says", provider.requests.some((req) => req.path === "/v1/search" && req.body?.title === "grace" && req.body.limit > 0));
  r = await call(someone, "GET", `/plugins/chords/${source.id}/songs/grace-1`);
  check(
    "a ChordPro chart, with its details and rights",
    r.status === 200 && r.body.content.includes("[G]Amazing grace") && r.body.key === "G" && r.body.tempo === 72 && r.body.rights === "Public domain: free to use." && r.body.writers.join() === "John Newton",
    JSON.stringify(r.body),
  );
  r = await call(someone, "GET", `/plugins/chords/${source.id}/songs/holy-2`);
  check("a SongDocument v2, read and written out as ChordPro", r.status === 200 && r.body.content.includes("{start_of_verse}") && r.body.content.includes("[D]Holy, holy, [Bm]holy"), r.body.content ?? JSON.stringify(r.body));
  r = await call(someone, "GET", `/plugins/chords/${source.id}/songs/nothing-here`);
  check("a song it doesn't have: 404", r.status === 404, JSON.stringify(r.body));
  check("a title is needed", (await call(someone, "GET", "/plugins/chords/search")).status === 400);

  // Song info and artwork, in Auto detect.
  r = await call(someone, "GET", `/metadata/search?${new URLSearchParams({ title: "Amazing Grace", artist: "Example Choir" })}`);
  const match = r.body.matches?.[0];
  check(
    "Auto detect finds it, the server named on its source",
    r.status === 200 && match?.title === "Amazing Grace" && match.sources[0].provider === "song_providers" && match.sources[0].name === `Example songs ${stamp}` && match.sources[0].id === `${source.id}:grace-1`,
    JSON.stringify(r.body),
  );
  r = await call(someone, "POST", "/metadata/lookup", { sources: match.sources.map(({ provider: key, id }) => ({ provider: key, id })) });
  check(
    "looked up again: writers, ISRC, tempo and length",
    r.status === 200 && r.body.composers?.join() === "John Newton" && r.body.isrc === "USXXX1900001" && r.body.tempo === 72 && r.body.durationSeconds === 245,
    JSON.stringify(r.body),
  );
  const song = await api(someone, "POST", "/song-versions", { title: `Amazing Grace ${stamp}`, language: "en", artists: ["Example Choir"] });
  r = await call(someone, "POST", `/song-versions/${song.id}/metadata-link`, { sources: match.sources.map(({ provider: key, id }) => ({ provider: key, id })) });
  check("linked: the artwork downloaded from the server's own address", r.status === 201 && sql(`select "imageSourceUrl" from "SongVersion" where id='${song.id}'`) === `${provider.url}/images/grace-1.png`, JSON.stringify(r.body).slice(0, 300));

  const settings = await api(admin, "GET", "/admin/metadata");
  const listed = settings.providers.find((one) => one.key === "song_providers");
  check("Admin > Metadata lists the song providers, ready for what a server is asked", listed?.ready.songInfo === true && listed.ready.artwork === true && listed.ready.artistBios === false, JSON.stringify(listed));

  // The hooks chosen per server.
  r = await call(admin, "PATCH", `/admin/plugins/song-provider/sources/${source.id}`, { hooks: ["songInfo"] });
  check("asked for song info only", r.status === 200 && r.body.plugins.find((one) => one.id === "song-provider").sources[0].hooks.join() === "songInfo", JSON.stringify(r.body));
  check("then Find chords has nowhere to look", (await api(someone, "GET", "/plugins/chords")).available === false);
  r = await call(admin, "PATCH", `/admin/plugins/song-provider/sources/${source.id}`, { hooks: ["songInfo", "chords", "sheets"] });
  check("a hook that isn't one is refused", r.status === 400);
  await api(admin, "PATCH", `/admin/plugins/song-provider/sources/${source.id}`, { hooks: ["songInfo", "artwork", "artistPictures", "chords"] });

  // A server that fails.
  provider.setDown(true);
  r = await call(someone, "GET", `/plugins/chords/search?${new URLSearchParams({ title: "grace" })}`);
  check("down: Find chords says so, without a crash", r.status === 503, JSON.stringify(r.body));
  found = await plugin();
  check("its error shown in Admin", /answered 503: Down for maintenance/.test(found.sources[0].lastError ?? ""), JSON.stringify(found.sources[0]));
  r = await call(admin, "POST", `/admin/plugins/song-provider/sources/${source.id}/test`);
  check("Test connection says what's wrong", r.status === 200 && r.body.ok === false && /503/.test(r.body.message), JSON.stringify(r.body));
  provider.setDown(false);
  r = await call(admin, "POST", `/admin/plugins/song-provider/sources/${source.id}/test`);
  check("and that it's back", r.body.ok === true && r.body.source.lastError === null, JSON.stringify(r.body));

  // A key changed is asked again; turned off, the server isn't asked.
  r = await call(admin, "PATCH", `/admin/plugins/song-provider/sources/${source.id}`, { apiKey: "another-wrong-key" });
  check("a new key that doesn't work isn't saved", r.status === 400 && (await plugin()).sources[0].hasApiKey === true, JSON.stringify(r.body));
  await api(admin, "PATCH", `/admin/plugins/song-provider/sources/${source.id}`, { enabled: false });
  check("a server turned off isn't asked", (await api(someone, "GET", "/plugins/chords")).available === false);
  check("nor changed by anyone but an admin", (await call(someone, "PATCH", `/admin/plugins/song-provider/sources/${source.id}`, { enabled: true })).status === 403);

  r = await call(admin, "DELETE", `/admin/plugins/song-provider/sources/${source.id}`);
  check("removed", r.status === 200 && r.body.plugins.find((one) => one.id === "song-provider").sources.length === 0);
} finally {
  for (const source of (await plugin()).sources) await api(admin, "DELETE", `/admin/plugins/song-provider/sources/${source.id}`);
  await api(admin, "DELETE", "/admin/plugins/song-provider");
  await api(admin, "DELETE", "/admin/metadata");
  await provider.close();
}
finish();
