// Stand-ins for the music services the API asks, for the suites: Apple's
// iTunes Search API and its artwork (issue #85; ITUNES_SEARCH_URL),
// MusicBrainz and Deezer (issue #22; MUSICBRAINZ_API_URL at /mb/ws/2/,
// DEEZER_API_URL at /deezer), and the Apple Music API (issue #87;
// APPLE_MUSIC_API_URL at /applemusic), which checks the developer token's
// signature against `appleMusicKey.publicKey` - and a developer token
// address (/applemusic-token) handing out tokens signed with
// `appleMusicKey.privateKey`, counting how often it's asked.
// Artists (issue #86): Deezer's artist search (a picture, unless the name
// has "Nopicture" in it), MusicBrainz's artists with a Wikidata link (none
// for "Nobio"), Wikidata (WIKIDATA_API_URL at /wikidata/w/api.php) and
// Wikipedia's summaries (WIKIPEDIA_URL at /wikipedia/{lang}).
// YouVersion's Platform API (issue #304; YOUVERSION_API_URL at /youversion),
// shaped as its documentation describes: the key in X-YVP-App-Key
// (`youversionKey`), version 3034 (with a copyright line) and 9001 (without)
// in English, John 3's 36 verses, and 429 in plain text for the key "spent-allowance-key".
// Spotify (issue #89; SPOTIFY_API_URL at /spotify, SPOTIFY_ACCOUNTS_URL at
// /spotify-accounts): app tokens for `spotifyApp`'s client ID and secret,
// then the song on "Album 1" (2013, ISRC USSPOT1300001) and on "Spotify
// Singles" (2021), and artists' pictures.
// A search for anything with "Nomatch" in it finds nothing; "Deezerdown"
// makes Deezer fail, "Itunesdown" Apple's iTunes Search (issue #93). Otherwise, for a title and
// an artist:
// - Apple Music: three albums, "Album 1" (2013), "Album 2" (2016) and
//   "Album 3" (2019), each with artwork of its own colour;
// - MusicBrainz: the song, first released on "Album 1" (listed after a 2016
//   compilation), a karaoke version from 2010, and the title by another band;
// - Deezer: the song on "Album 1" and on "Live 2020".
import { sign, verify } from "node:crypto";
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";

export const FAKE_PROVIDERS_PORT = Number(process.env.FAKE_PROVIDERS_PORT ?? 3999);
export const FAKE_PROVIDERS_URL = `http://localhost:${FAKE_PROVIDERS_PORT}`;
const URL_ = FAKE_PROVIDERS_URL;

/** A 16x16 PNG of one colour. */
export function png(r, g, b) {
  const crc = (buf) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const size = 16;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rows.set([r, g, b], y * (1 + size * 3) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const COLOURS = [
  [200, 40, 40],
  [40, 160, 60],
  [40, 60, 200],
];

const json = (res, body, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

// --- Apple Music
const APPLE_DATES = ["2013-02-22T08:00:00Z", "2016-06-01T07:00:00Z", "2019-09-13T07:00:00Z"];
const appleSong = (title, artist, n) => ({
  wrapperType: "track",
  trackId: 1000 + n,
  trackName: title,
  artistName: artist,
  collectionName: `Album ${n + 1}`,
  releaseDate: APPLE_DATES[n],
  artworkUrl100: `${URL_}/art/${n}/100x100bb.png`,
  trackViewUrl: `https://music.apple.com/us/album/x/${2000 + n}?i=${1000 + n}`,
});
/** Apple searches "title artist": the artist is the last word. */
const splitTerm = (term) => ({ title: term.replace(/\s+\S+$/, ""), artist: term.split(" ").at(-1) ?? "Someone" });
const lastApple = new Map();

// --- the Apple Music API: the same songs, with ISRCs and writers
/** The public key the Apple Music API stand-in checks tokens with: a suite sets it. */
export const appleMusicKey = { publicKey: null, privateKey: null, teamId: null, keyId: null, tokenHits: 0 };
function mintToken() {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ kid: appleMusicKey.keyId, alg: "ES256" })}.${b64({ iss: appleMusicKey.teamId, iat: now, exp: now + 30 * 24 * 3600 })}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), { key: appleMusicKey.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
function validToken(header) {
  const [h, p, sig] = (header ?? "").replace(/^Bearer /, "").split(".");
  if (!h || !p || !sig || !appleMusicKey.publicKey) return false;
  const head = JSON.parse(Buffer.from(h, "base64url").toString());
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  if (head.alg !== "ES256" || head.kid !== appleMusicKey.keyId || claims.iss !== appleMusicKey.teamId || claims.exp * 1000 < Date.now()) return false;
  return verify("sha256", Buffer.from(`${h}.${p}`), { key: appleMusicKey.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"));
}
const appleMusicSong = (song) => ({
  id: String(song.trackId),
  type: "songs",
  attributes: {
    name: song.trackName,
    artistName: song.artistName,
    albumName: song.collectionName,
    releaseDate: song.releaseDate.slice(0, 10),
    isrc: `USFAK13${String(song.trackId).padStart(5, "0")}`,
    composerName: "Joel Houston, Matt Crocker & Salomon Ligthelm",
    url: song.trackViewUrl,
    artwork: { url: song.artworkUrl100.replace("100x100bb", "{w}x{h}bb") },
  },
});

// --- MusicBrainz
const mbid = (n, title) => `00000000-0000-4000-8000-${String(n).padStart(4, "0")}${Buffer.from(title).toString("hex").slice(0, 8).padEnd(8, "0")}`;
const lastRecordings = new Map();
function recordings(title, artist) {
  const credit = (name) => [{ name }];
  return [
    {
      id: mbid(1, title),
      title,
      score: 100,
      "artist-credit": credit(artist),
      "first-release-date": "2013-02-22",
      releases: [
        { title: "Best of Worship", date: "2016-01-01", status: "Official" },
        { title: "Album 1", date: "2013-02-22", status: "Official" },
      ],
    },
    { id: mbid(2, title), title: `${title} (Karaoke Version)`, score: 90, "artist-credit": credit(artist), "first-release-date": "2010", releases: [{ title: "Sing Along", date: "2010" }] },
    { id: mbid(3, title), title, score: 80, "artist-credit": credit("Other Band"), "first-release-date": "1990", releases: [{ title: "Old Songs", date: "1990" }] },
  ];
}
const unescape = (text) => text.replace(/\\(.)/g, "$1");

// --- Deezer
const lastDeezer = new Map();
const deezerTracks = (title, artist) => [
  { id: 5001, title, link: "https://www.deezer.com/track/5001", artist: { name: artist }, album: { id: 7001, title: "Album 1", cover_medium: `${URL_}/art/2/250x250.png`, cover_xl: `${URL_}/art/2/1000x1000.png` } },
  { id: 5002, title, link: "https://www.deezer.com/track/5002", artist: { name: artist }, album: { id: 7002, title: "Live 2020", cover_medium: `${URL_}/art/1/250x250.png`, cover_xl: `${URL_}/art/1/1000x1000.png` } },
];
const ALBUM_DATES = { 7001: "2013-02-22", 7002: "2020-05-01" };

// --- Spotify
/** The app the Spotify stand-in accepts: a suite sets it. */
export const spotifyApp = { clientId: null, clientSecret: null, tokenHits: 0 };
const spotifyTokens = new Set();
const lastSpotify = new Map();
const spotifyImages = (n) => [640, 300, 64].map((width) => ({ url: `${URL_}/art/${n}/${width}x${width}.png`, width, height: width }));
const spotifyTracks = (title, artist) => [
  { id: "sp1track0000000000001", name: title, artists: [{ name: artist }], album: { name: "Album 1", release_date: "2013-02-22", images: spotifyImages(2) }, external_ids: { isrc: "USSPOT1300001" }, external_urls: { spotify: "https://open.spotify.com/track/sp1track0000000000001" } },
  { id: "sp2track0000000000002", name: title, artists: [{ name: artist }], album: { name: "Spotify Singles", release_date: "2021", images: spotifyImages(1) }, external_ids: {}, external_urls: { spotify: "https://open.spotify.com/track/sp2track0000000000002" } },
];

// --- YouTube (issue #169)
/** The key the YouTube stand-in accepts, and how many searches it got: a suite sets it. */
export const youtubeKey = { key: null, searches: 0 };

// --- YouVersion (issue #304)
/** The App Key the YouVersion stand-in accepts, and how many passages it gave: a suite sets it. */
export const youversionKey = { key: null, passages: 0 };

const youversionBibles = {
  3034: {
    id: 3034,
    abbreviation: "BSB",
    title: "Berean Standard Bible",
    localized_title: "Berean Standard Bible",
    localized_abbreviation: "BSB",
    language_tag: "en",
    copyright: "The Holy Bible, Berean Standard Bible, BSB.",
    info: "Dedicated to the public domain.",
    promotional_content: null,
    publisher_url: "https://berean.bible",
    youversion_deep_link: "https://www.bible.com/versions/3034",
    books: ["JHN"],
    organization_id: null,
  },
  9001: { id: 9001, abbreviation: "NOC", title: "No Copyright Version", language_tag: "en", copyright: "", info: null, books: ["JHN"] },
};

function youversionAnswer(req, url, res) {
  const key = req.headers["x-yvp-app-key"];
  if (!key) return json(res, { fault: { faultstring: "Failed to resolve API Key variable request.header.x-yvp-app-key", detail: { errorcode: "steps.oauth.v2.FailedToResolveAPIKey" } } }, 401);
  if (key === "spent-allowance-key") {
    res.writeHead(429, { "Content-Type": "text/plain" });
    return res.end("Rate limit exceeded.");
  }
  if (key !== youversionKey.key) return json(res, { fault: { faultstring: "Invalid ApiKey", detail: { errorcode: "oauth.v2.InvalidApiKey" } } }, 401);
  const path = url.pathname.replace(/^\/youversion/, "");
  if (path === "/v1/bibles") {
    const english = url.searchParams.getAll("language_ranges[]").some((range) => /^en\b/.test(range));
    return json(res, { data: english ? Object.values(youversionBibles) : [], next_page_token: null, total_size: english ? 2 : 0 });
  }
  const bible = /^\/v1\/bibles\/(\d+)(\/.*)?$/.exec(path);
  const found = bible && youversionBibles[bible[1]];
  if (!found) return json(res, { message: "Bible not found" }, 404);
  const rest = bible[2] ?? "";
  if (rest === "") return json(res, found);
  if (rest === "/books/JHN/chapters/3/verses") return json(res, { data: Array.from({ length: 36 }, (_, i) => ({ id: String(i + 1), passage_id: `JHN.3.${i + 1}`, title: String(i + 1) })) });
  const passage = /^\/passages\/(JHN\.3(?:\.(\d+))?)$/.exec(rest);
  if (passage && (!passage[2] || Number(passage[2]) <= 36)) {
    youversionKey.passages++;
    const reference = passage[2] ? `John 3:${passage[2]}` : "John 3";
    return json(res, { id: passage[1], content: `${found.abbreviation} text of ${reference}.`, reference });
  }
  return json(res, { message: "Passage not found" }, 404);
}

// --- artists
const artistNames = new Map();
const qids = new Map();

/** Requests for the address an image host redirected to, which the API must never make (issue #112). */
export const imageHost = { internalHits: 0 };

export function startFakeProviders() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, URL_);
    const path = url.pathname;
    if (path === "/search") {
      const term = url.searchParams.get("term") ?? "";
      if (/itunesdown/i.test(term)) return json(res, { errorMessage: "down" }, 503);
      const { title, artist } = splitTerm(term);
      const results = /nomatch/i.test(term) ? [] : [0, 1, 2].map((n) => appleSong(title, artist, n));
      for (const song of results) lastApple.set(String(song.trackId), song);
      return json(res, { resultCount: results.length, results });
    }
    if (path === "/lookup") {
      const song = lastApple.get(url.searchParams.get("id") ?? "");
      return json(res, { resultCount: song ? 1 : 0, results: song ? [song] : [] });
    }
    if (path === "/applemusic-token") {
      appleMusicKey.tokenHits++;
      return json(res, { storefront_id: "143441-1,29", token: mintToken(), token_type: "Bearer", cache_ttl_seconds: 120 });
    }
    if (path.startsWith("/applemusic/")) {
      if (!validToken(req.headers.authorization)) return json(res, { errors: [{ status: "401" }] }, 401);
      const search = /^\/applemusic\/v1\/catalog\/[a-z]{2}\/search$/.test(path);
      if (search) {
        const term = url.searchParams.get("term") ?? "";
        const { title, artist } = splitTerm(term);
        const songs = /nomatch/i.test(term) ? [] : [0, 1, 2].map((n) => appleSong(title, artist, n));
        for (const song of songs) lastApple.set(String(song.trackId), song);
        return json(res, { results: songs.length ? { songs: { data: songs.map(appleMusicSong) } } : {} });
      }
      const one = /^\/applemusic\/v1\/catalog\/[a-z]{2}\/songs\/(\d+)$/.exec(path);
      const song = one && lastApple.get(one[1]);
      return song ? json(res, { data: [appleMusicSong(song)] }) : json(res, { errors: [{ status: "404" }] }, 404);
    }
    if (path === "/spotify-accounts/api/token" && req.method === "POST") {
      const [id, secret] = Buffer.from((req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString().split(":");
      if (!spotifyApp.clientId || id !== spotifyApp.clientId || secret !== spotifyApp.clientSecret) return json(res, { error: "invalid_client" }, 400);
      spotifyApp.tokenHits++;
      const token = `sptok${spotifyApp.tokenHits}${Date.now()}`;
      spotifyTokens.add(token);
      return json(res, { access_token: token, token_type: "Bearer", expires_in: 3600 });
    }
    if (path.startsWith("/spotify/")) {
      if (!spotifyTokens.has((req.headers.authorization ?? "").replace(/^Bearer /, ""))) return json(res, { error: { status: 401, message: "Invalid access token" } }, 401);
      if (path === "/spotify/v1/search") {
        // As Spotify does for an app in development mode (issue #90).
        if (Number(url.searchParams.get("limit") ?? 5) > 10) return json(res, { error: { status: 400, message: "Invalid limit" } }, 400);
        const q = url.searchParams.get("q") ?? "";
        if (url.searchParams.get("type") === "artist") {
          return json(res, { artists: { items: [{ id: "spartist1", name: q, images: /nopicture/i.test(q) ? [] : spotifyImages(0), external_urls: { spotify: "https://open.spotify.com/artist/spartist1" } }] } });
        }
        const title = /track:"([^"]*)"/.exec(q)?.[1] ?? q;
        const artist = /artist:"([^"]*)"/.exec(q)?.[1] ?? "Someone";
        const items = /nomatch/i.test(q) ? [] : spotifyTracks(title, artist);
        for (const track of items) lastSpotify.set(track.id, track);
        return json(res, { tracks: { items } });
      }
      const track = /^\/spotify\/v1\/tracks\/(\w+)$/.exec(path);
      const found = track && lastSpotify.get(track[1]);
      return found ? json(res, found) : json(res, { error: { status: 404, message: "Non existing id" } }, 404);
    }
    if (path.startsWith("/youversion/")) return youversionAnswer(req, url, res);
    if (path === "/youtube/search") {
      const key = url.searchParams.get("key");
      if (!youtubeKey.key || key !== youtubeKey.key) return json(res, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", errors: [{ reason: "badRequest" }] } }, 400);
      youtubeKey.searches++;
      const q = url.searchParams.get("q") ?? "";
      if (/quotagone/i.test(q)) return json(res, { error: { code: 403, message: "quota", errors: [{ reason: "quotaExceeded" }] } }, 403);
      const items = /nomatch/i.test(q)
        ? []
        : [1, 2].map((n) => ({
            id: { kind: "youtube#video", videoId: `ytvideo000${n}` },
            snippet: { title: `${q} (Official Video &amp; Lyrics) ${n}`, channelTitle: `Channel ${n}`, thumbnails: { medium: { url: `${URL_}/art/${n}/320x180.png` } } },
          }));
      return json(res, { items });
    }
    if (path === "/deezer/search/artist") {
      const q = url.searchParams.get("q") ?? "";
      if (/deezerdown/i.test(q)) return json(res, { error: "down" }, 500);
      const picture = /nopicture/i.test(q) ? "https://e-cdns-images.dzcdn.net/images/artist//1000x1000-000000-80-0-0.jpg" : `${URL_}/art/1/1000x1000.png`;
      return json(res, { data: [{ id: 9001, name: q, link: "https://www.deezer.com/artist/9001", picture_xl: picture }] });
    }
    if (path === "/mb/ws/2/artist") {
      const name = unescape(/artist:"((?:[^"\\]|\\.)*)"/.exec(url.searchParams.get("query") ?? "")?.[1] ?? "");
      const id = mbid(9, name);
      artistNames.set(id, name);
      return json(res, { artists: [{ id, name, score: 100 }] });
    }
    const mbArtist = /^\/mb\/ws\/2\/artist\/([\w-]+)$/.exec(path);
    if (mbArtist) {
      const name = artistNames.get(mbArtist[1]) ?? "";
      if (/nobio/i.test(name)) return json(res, { relations: [] });
      const qid = `Q${1000 + qids.size}`;
      qids.set(qid, name);
      return json(res, { relations: [{ type: "wikidata", url: { resource: `https://www.wikidata.org/wiki/${qid}` } }] });
    }
    if (path === "/wikidata/w/api.php") {
      const qid = url.searchParams.get("ids") ?? "";
      const name = qids.get(qid);
      return json(res, { entities: { [qid]: { sitelinks: name ? { enwiki: { title: name }, frwiki: { title: name } } : {} } } });
    }
    const wiki = /^\/wikipedia\/(\w+)\/api\/rest_v1\/page\/summary\/(.+)$/.exec(path);
    if (wiki) {
      const [, language, title] = wiki;
      const name = decodeURIComponent(title).replace(/_/g, " ");
      return json(res, { type: "standard", extract: language === "fr" ? `${name} est un groupe.` : `${name} is a band.`, content_urls: { desktop: { page: `https://${language}.wikipedia.org/wiki/${title}` } } });
    }
    if (path === "/mb/ws/2/recording") {
      const query = url.searchParams.get("query") ?? "";
      const title = unescape(/recording:"((?:[^"\\]|\\.)*)"/.exec(query)?.[1] ?? "");
      const artist = unescape(/artist:"((?:[^"\\]|\\.)*)"/.exec(query)?.[1] ?? "Someone");
      const found = /nomatch/i.test(title) ? [] : recordings(title, artist);
      for (const recording of found) lastRecordings.set(recording.id, recording);
      return json(res, { recordings: found });
    }
    const recording = /^\/mb\/ws\/2\/recording\/([\w-]+)$/.exec(path);
    if (recording) {
      const found = lastRecordings.get(recording[1]);
      return found ? json(res, found) : json(res, { error: "Not Found" }, 404);
    }
    if (path === "/deezer/search") {
      const q = url.searchParams.get("q") ?? "";
      if (/deezerdown/i.test(q)) return json(res, { error: "down" }, 500);
      const title = /track:"([^"]*)"/.exec(q)?.[1] ?? q;
      const artist = /artist:"([^"]*)"/.exec(q)?.[1] ?? "Someone";
      const data = /nomatch/i.test(q) ? [] : deezerTracks(title, artist);
      for (const track of data) lastDeezer.set(String(track.id), track);
      return json(res, { data, total: data.length });
    }
    const album = /^\/deezer\/album\/(\d+)$/.exec(path);
    if (album) return json(res, ALBUM_DATES[album[1]] ? { id: Number(album[1]), release_date: ALBUM_DATES[album[1]] } : { error: { type: "DataException", message: "no data", code: 800 } });
    const track = /^\/deezer\/track\/(\d+)$/.exec(path);
    if (track) {
      const found = lastDeezer.get(track[1]);
      return json(res, found ? { ...found, release_date: ALBUM_DATES[found.album.id] } : { error: { type: "DataException", message: "no data", code: 800 } });
    }
    // An image host sending the server elsewhere, and one too big to take (issue #112).
    // Elsewhere: this server, but at an address that isn't allowed (127.0.0.1, not localhost).
    if (path === "/art/elsewhere.png") {
      res.writeHead(302, { Location: `http://127.0.0.1:${FAKE_PROVIDERS_PORT}/art/internal.png` });
      res.end();
      return;
    }
    if (path === "/art/internal.png") imageHost.internalHits++;
    if (path === "/art/huge.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(Buffer.alloc(6 * 1024 * 1024));
      return;
    }
    const art = /^\/art\/(\d)\//.exec(path);
    if (art) {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(png(...COLOURS[Number(art[1])]));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(FAKE_PROVIDERS_PORT, () => resolve(server));
  });
}
