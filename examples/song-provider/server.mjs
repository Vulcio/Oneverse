#!/usr/bin/env node
// An example Song provider API server (issue #157): a few songs in memory,
// answered the way docs/song-provider-api.json says. Dependency-free: run
// it with `node examples/song-provider/server.mjs` and add
// http://localhost:4100 in Admin > Plugins > Song provider (tick "On this
// network"), key "example-key". Copy it to start your own: replace SONGS
// with your catalogue, keep the answers' shapes.
//
// Oneverse's e2e suites use it as their stand-in (e2e/lib/fake-song-provider.mjs).
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

/** The catalogue: the details GET /v1/songs/{id} answers, and the chart its /content does. */
export const EXAMPLE_SONGS = [
  {
    id: "grace-1",
    title: "Amazing Grace",
    artists: ["Example Choir"],
    writers: ["John Newton"],
    album: "Hymns We Love",
    releaseDate: "2019-04-12",
    key: "G",
    language: "en",
    tempo: 72,
    timeSignature: "3/4",
    durationSeconds: 245,
    isrc: "USXXX1900001",
    ccli: "22025",
    copyright: "Public domain",
    links: ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    // Several charts of it (issue #369): each its rating, where it comes from, and its own chart.
    versions: [
      {
        id: "grace-1-simple",
        name: "Simplified",
        key: "C",
        author: "Marie",
        rating: { value: 4.2, count: 15 },
        source: { name: "Chord Sharers", url: "https://chords.example.org/amazing-grace" },
        content: {
          format: "chordpro",
          content: "{start_of_verse: Verse 1}\n[C]Amazing grace, how sweet the [F]sound\nThat saved a wretch like [G]me\n{end_of_verse}\n",
          rights: "Shared by its author for worship use.",
        },
      },
      {
        id: "grace-1-original",
        name: "Original",
        key: "G",
        rating: { value: 4.7, count: 120 },
        source: { name: "Example Chords", url: "https://chords.example.com/amazing-grace" },
      },
      { id: "grace-1-capo", name: "Capo 2", key: "A", capo: 2 },
    ],
    content: {
      format: "chordpro",
      content: "{start_of_verse: Verse 1}\n[G]Amazing grace, how [C]sweet the [G]sound\nThat saved a wretch like [D]me\n{end_of_verse}\n\n{start_of_chorus}\n[C]My chains are [G]gone\n{end_of_chorus}\n\n{chorus}\n",
      rights: "Public domain: free to use.",
    },
  },
  {
    id: "holy-2",
    title: "Holy, Holy, Holy",
    artists: ["Example Choir"],
    writers: ["Reginald Heber", "John Dykes"],
    album: "Hymns We Love",
    releaseDate: "2019",
    key: "D",
    language: "en",
    content: {
      format: "song-document/v2",
      content: {
        $schema: "song-document/v2",
        revision: 1,
        defaults: {},
        sections: [
          {
            id: "s1",
            type: "verse",
            lines: [{ id: "l1", kind: "lyric", text: "Holy, holy, holy, Lord God Almighty", chords: [{ id: "c1", at: 0, raw: "D" }, { id: "c2", at: 12, raw: "Bm" }] }],
          },
        ],
        flow: [{ id: "f1", sectionId: "s1" }],
      },
      copyright: "Public domain",
    },
  },
  { id: "info-3", title: "Grâce infinie", artists: ["Chorale Exemple"], language: "fr", key: "G" },
];

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const fail = (res, status, code, message) => json(res, status, { error: { code, message } });
const fold = (text) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** What a song is listed as in a search. */
function summary(song, origin) {
  return {
    id: song.id,
    title: song.title,
    artists: song.artists,
    album: song.album ?? null,
    releaseDate: song.releaseDate ?? null,
    key: song.key ?? null,
    language: song.language ?? null,
    thumbnailUrl: `${origin}/images/${song.id}.png`,
    artworkUrl: `${origin}/images/${song.id}.png`,
    url: `${origin}/songs/${song.id}`,
    hasContent: !!song.content,
    versions: (song.versions ?? []).map(({ content: _content, ...version }) => version),
  };
}

// A 1×1 PNG, the artwork and artists' pictures.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

/**
 * Starts the server. `apiKey` null takes no key; `provides` is what
 * /v1/capabilities says it answers. Every request is kept in `requests`.
 */
export function startExampleSongProvider({ port = 4100, apiKey = "example-key", name = "Example songs", provides = ["songInfo", "artwork", "artistPictures", "chords"], songs = EXAMPLE_SONGS } = {}) {
  const requests = [];
  const state = { down: false };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const origin = `http://${req.headers.host}`;
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: body ? JSON.parse(body) : null, authorization: req.headers.authorization ?? null });
    // Pictures are public; the API takes the key.
    if (url.pathname.startsWith("/images/")) {
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": PNG.length });
      return res.end(PNG);
    }
    if (state.down) return fail(res, 503, "error", "Down for maintenance");
    if (apiKey && req.headers.authorization !== `Bearer ${apiKey}`) return fail(res, 401, "unauthorized", "A valid key is needed");
    if (req.method === "GET" && url.pathname === "/v1/capabilities") return json(res, 200, { apiVersion: 1, name, provides, languages: ["en", "fr"], homepage: origin });
    if (req.method === "POST" && url.pathname === "/v1/search") {
      let query;
      try {
        query = JSON.parse(body);
      } catch {
        return fail(res, 400, "invalid", "The body must be JSON");
      }
      if (!query?.title) return fail(res, 400, "invalid", "title is required");
      const found = songs
        .filter((song) => fold(song.title).includes(fold(query.title)) || fold(query.title).includes(fold(song.title)))
        .filter((song) => !query.artist || song.artists.some((artist) => fold(artist).includes(fold(query.artist))))
        .filter((song) => !query.language || !song.language || song.language === query.language)
        .slice(0, query.limit ?? 10);
      return json(res, 200, { songs: found.map((song) => summary(song, origin)) });
    }
    const songPath = /^\/v1\/songs\/([^/]+)(\/content)?$/.exec(url.pathname);
    if (req.method === "GET" && songPath) {
      const song = songs.find((one) => one.id === decodeURIComponent(songPath[1]));
      if (!song) return fail(res, 404, "not-found", "No such song");
      if (songPath[2]) {
        // ?version= one of its versions: its own chart, or the song's when it has none of its own.
        const wanted = url.searchParams.get("version");
        const version = wanted ? song.versions?.find((one) => one.id === wanted) : null;
        if (wanted && !version) return fail(res, 404, "not-found", "No such version");
        const content = version?.content ?? song.content;
        return content ? json(res, 200, content) : fail(res, 404, "not-found", "No chords for this song");
      }
      const { content: _content, versions: _versions, ...details } = song;
      return json(res, 200, { ...summary(song, origin), writers: [], links: [], ...details });
    }
    if (req.method === "GET" && url.pathname === "/v1/artists/picture") {
      const wanted = fold(url.searchParams.get("name"));
      const known = songs.some((song) => song.artists.some((artist) => fold(artist) === wanted));
      if (!known) return fail(res, 404, "not-found", "No picture of that artist");
      return json(res, 200, { url: `${origin}/images/artist-${encodeURIComponent(wanted)}.png`, pageUrl: `${origin}/artists/${encodeURIComponent(wanted)}` });
    }
    fail(res, 404, "not-found", `No ${req.method} ${url.pathname}`);
  });
  return new Promise((resolve) =>
    server.listen(port, () =>
      resolve({
        url: `http://localhost:${port}`,
        requests,
        /** Answers 503 to everything but pictures, until set back. */
        setDown: (down) => {
          state.down = down;
        },
        close: () => new Promise((done) => server.close(done)),
      }),
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4100);
  const provider = await startExampleSongProvider({ port, apiKey: process.env.API_KEY ?? "example-key" });
  console.log(`Example Song provider at ${provider.url}/v1 (key: ${process.env.API_KEY ?? "example-key"})`);
}
