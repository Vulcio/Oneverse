// Song images (issue #85): a new song's artwork found on its own, from
// Apple Music (a stand-in, see lib/fake-providers.mjs) and kept on our
// storage; served at a signed address only to who can see the song;
// chosen among the matches, uploaded (issue #88) or removed by its editors; the admin's settings
// and backfill; one image for two songs with the same artwork.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";
import { FAKE_PROVIDERS_URL, imageHost, png, startFakeProviders } from "../lib/fake-providers.mjs";

const fake = await startFakeProviders();
const owner = await user("Painter");
const viewer = await user("Viewer");
const stranger = await user("Stranger");
const admin = await user("Admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await api(admin, "DELETE", "/admin/artwork");

const make = (title) => api(owner, "POST", "/song-versions", { title: `${title} ${stamp}`, language: "en", artists: ["Painter"] });
async function imageOf(who, id, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const song = await api(who, "GET", `/song-versions/${id}`);
    if (song.imageUrl) return song.imageUrl;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
const fetchImage = (url) => fetch(url);

// --- found on its own, kept on our storage
const song = await make("Artful");
const url = await imageOf(owner, song.id);
check("a new song gets its artwork on its own", !!url, String(url));
check("at a signed address on our API, not Apple's", url?.startsWith(`${API}/song-versions/${song.id}/image/`) && url.includes("signature="), url);
check("where it came from is kept", sql(`select "imageSourceUrl" from "SongVersion" where id='${song.id}'`).startsWith(`${FAKE_PROVIDERS_URL}/art/0/800x800bb`));
let res = await fetchImage(`${url}&w=64`);
check("served, resized, without a token", res.status === 200 && res.headers.get("content-type") === "image/webp", String(res.status));
res = await fetchImage(url.replace(/signature=[^&]+/, "signature=forged"));
check("a forged signature doesn't", res.status === 403, String(res.status));
res = await fetchImage(url.replace(/expires=\d+/, `expires=${Date.now() - 1000}`));
check("nor an expired address", res.status === 403, String(res.status));
check("the list has it too", (await api(owner, "GET", `/song-versions?q=${encodeURIComponent(`Artful ${stamp}`)}`)).items[0]?.imageUrl?.startsWith(`${API}/song-versions/${song.id}/image/`));

// --- only who can see the song gets its address
check("someone who can't see the song gets no address", (await call(stranger, "GET", `/song-versions/${song.id}`)).status === 403);
check("nor can find its artwork", (await call(stranger, "GET", `/song-versions/${song.id}/artwork/candidates`)).status === 403);

// --- choosing among the matches; only its editors
const candidates = await api(owner, "GET", `/song-versions/${song.id}/artwork/candidates`);
check(
  "the artwork providers' matches, in their order (issue #89), each artwork once",
  candidates.map((c) => c.provider).join() === "apple_music,apple_music,apple_music,deezer,deezer" && candidates[1].album === "Album 2" && candidates[1].artworkUrl.endsWith("/art/1/800x800bb.png"),
  JSON.stringify(candidates.map((c) => [c.provider, c.album])),
);
let r = await call(owner, "PUT", `/song-versions/${song.id}/artwork`, { url: candidates[1].artworkUrl });
const chosen = await api(owner, "GET", `/song-versions/${song.id}`);
check("another one chosen", r.status === 204 && chosen.imageUrl && chosen.imageUrl.split("/image/")[1].split("?")[0] !== url.split("/image/")[1].split("?")[0], String(r.status));
r = await call(owner, "PUT", `/song-versions/${song.id}/artwork`, { url: "https://evil.example.com/cover.png" });
check("only from Apple Music", r.status === 400, String(r.status));
r = await call(owner, "PUT", `/song-versions/${song.id}/artwork`, { url: candidates[1].artworkUrl.replace(/\/art\/.*$/, "/art/elsewhere.png") });
check("nor from where an image host sends it (issue #112), not even asked", r.status === 400 && /Apple Music, Deezer, Spotify or a song provider/.test(r.body?.message) && imageHost.internalHits === 0, `${JSON.stringify(r.body)} ${imageHost.internalHits}`);
r = await call(owner, "PUT", `/song-versions/${song.id}/artwork`, { url: candidates[1].artworkUrl.replace(/\/art\/.*$/, "/art/huge.png") });
check("nor an image over 5 MB", r.status === 400 && /too big/.test(r.body?.message), JSON.stringify(r.body));
// Shared with someone to view: they see it, can't change it.
await api(owner, "POST", "/people/requests", { email: viewer.email });
const request = (await api(viewer, "GET", "/people")).incoming.find((i) => i.from.id === owner.id);
await api(viewer, "POST", `/people/requests/${request.id}/accept`);
await api(owner, "PUT", `/song-versions/${song.id}/shares/${viewer.id}`, { canEdit: false });
check("someone it's shared with sees it", !!(await api(viewer, "GET", `/song-versions/${song.id}`)).imageUrl);
r = await call(viewer, "PUT", `/song-versions/${song.id}/artwork`, { url: candidates[0].artworkUrl });
check("but can't change it", r.status === 403, String(r.status));

// --- an image of their own (issue #88)
const upload = (who, id, body, type, name) => {
  const form = new FormData();
  form.append("file", new Blob([body], { type }), name);
  return fetch(`${API}/song-versions/${id}/artwork/upload`, { method: "POST", headers: { Authorization: `Bearer ${who.bearer}` }, body: form });
};
res = await upload(owner, song.id, png(250, 200, 10), "image/png", "mine.png");
check("uploaded", res.status === 204, String(res.status));
check("kept as theirs", sql(`select "imageSourceUrl" from "SongVersion" where id='${song.id}'`) === "upload");
res = await fetchImage(`${(await api(owner, "GET", `/song-versions/${song.id}`)).imageUrl}&w=64`);
check("and served like the rest", res.status === 200 && res.headers.get("content-type") === "image/webp", String(res.status));
res = await upload(owner, song.id, '<svg xmlns="http://www.w3.org/2000/svg"/>', "image/svg+xml", "x.svg");
check("not an SVG", res.status === 400, String(res.status));
res = await upload(owner, song.id, "not an image", "image/png", "broken.png");
check("nor something that isn't an image", res.status === 400, String(res.status));
res = await upload(viewer, song.id, png(1, 2, 3), "image/png", "v.png");
check("not by someone who can only view it", res.status === 403, String(res.status));

// --- one image for two songs with the same artwork; removing one keeps the other's
const twin = await make("Artful twin");
const twinUrl = await imageOf(owner, twin.id);
await api(owner, "PUT", `/song-versions/${song.id}/artwork`, { url: candidates[0].artworkUrl });
const key = (id) => sql(`select "imageStorageKey" from "SongVersion" where id='${id}'`);
check("the same artwork, stored once", key(song.id) === key(twin.id) && !!key(song.id));
r = await call(owner, "DELETE", `/song-versions/${song.id}/artwork`);
check("removed", r.status === 204 && (await api(owner, "GET", `/song-versions/${song.id}`)).imageUrl === null);
res = await fetchImage(`${twinUrl}&w=64`);
check("the other song's is still there", res.status === 200, String(res.status));
await call(owner, "DELETE", `/song-versions/${twin.id}`);
check("a deleted song's image, used by no one, is gone from storage", sql(`select count(*) from "SongVersion" where "imageStorageKey"='${key(song.id) || "none"}'`) === "0");

// --- nothing close enough: no image
const nomatch = await make("Nomatch");
await new Promise((r) => setTimeout(r, 2000));
check("nothing matching, no image", (await api(owner, "GET", `/song-versions/${nomatch.id}`)).imageUrl === null);

// --- the admin's settings
let settings = await api(admin, "GET", "/admin/artwork");
check("on, in the us storefront, by default", settings.enabled === true && settings.country === "us" && settings.source === "default", JSON.stringify(settings));
check("admins only", (await call(owner, "GET", "/admin/artwork")).status === 403);
r = await call(admin, "PUT", "/admin/artwork", { country: "frr" });
check("a country is two letters", r.status === 400, String(r.status));
settings = await api(admin, "PUT", "/admin/artwork", { enabled: false, country: "FR" });
check("saved", settings.enabled === false && settings.country === "fr" && settings.source === "database", JSON.stringify(settings));
const off = await make("Artful off");
await new Promise((r) => setTimeout(r, 2000));
check("turned off: no artwork for a new song", (await api(owner, "GET", `/song-versions/${off.id}`)).imageUrl === null);
check("nor a backfill", (await call(admin, "POST", "/admin/artwork/backfill")).status === 404);
settings = await api(admin, "DELETE", "/admin/artwork");
check("back to the defaults", settings.enabled === true && settings.source === "default");
r = await call(admin, "POST", "/admin/artwork/backfill");
check("the backfill starts, as a background job (issue #92)", r.status === 201 && r.body.queued === true, JSON.stringify(r.body));
check("and finds the songs without one", !!(await imageOf(owner, off.id, 240)));

fake.close();
finish();
