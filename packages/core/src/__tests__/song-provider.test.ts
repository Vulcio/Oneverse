import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  readSongProviderSourceId,
  SongProviderContentSchema,
  SongProviderSongSchema,
  SongProviderSearchResultSchema,
  SongProviderSongSummarySchema,
  songProviderSourceId,
} from "../song-provider/index.js";
import { chordSongs, ratingScore } from "../song-provider/find-chords.js";
import { songProviderOpenApi } from "../song-provider/openapi.js";

describe("Song provider API (issue #157)", () => {
  it("reads a song leniently: unknown fields ignored, left out is null", () => {
    const song = SongProviderSongSchema.parse({ id: "1", title: "Amazing Grace", artists: ["Choir"], extra: "ours" });
    expect(song).toMatchObject({ id: "1", title: "Amazing Grace", album: null, key: null, writers: [], links: [], hasContent: false });
    expect("extra" in song).toBe(false);
  });

  it("refuses an answer that doesn't fit rather than guessing", () => {
    expect(SongProviderSongSchema.safeParse({ id: "1", title: "", artists: [] }).success).toBe(false);
    expect(SongProviderSongSchema.safeParse({ id: "1", title: "A", tempo: -3 }).success).toBe(false);
    expect(SongProviderSearchResultSchema.safeParse({ songs: [{ id: "1", title: "A", thumbnailUrl: "not an address" }] }).success).toBe(false);
  });

  it("takes content as ChordPro or a SongDocument v2", () => {
    expect(SongProviderContentSchema.parse({ format: "chordpro", content: "[G]Grace" }).format).toBe("chordpro");
    expect(SongProviderContentSchema.parse({ format: "song-document/v2", content: { $schema: "song-document/v2" } }).format).toBe("song-document/v2");
    expect(SongProviderContentSchema.safeParse({ format: "pdf", content: "…" }).success).toBe(false);
  });

  it("names a provider's song in a metadata source as provider:song", () => {
    expect(songProviderSourceId("ckprov", "a:b")).toBe("ckprov:a:b");
    expect(readSongProviderSourceId("ckprov:a:b")).toEqual({ providerId: "ckprov", songId: "a:b" });
    expect(readSongProviderSourceId("nothing")).toBeNull();
    expect(readSongProviderSourceId(":x")).toBeNull();
  });

  it("is described by docs/song-provider-api.json as the schemas say (pnpm --filter @oneverse/core song-provider-api)", () => {
    const file = JSON.parse(readFileSync(new URL("../../../../docs/song-provider-api.json", import.meta.url), "utf8"));
    expect(file).toEqual(songProviderOpenApi());
  });
});

describe("Find chords: versions, ratings and the music services (issue #369)", () => {
  const song = (fields: Record<string, unknown>) => SongProviderSongSummarySchema.parse({ url: "https://songs.example.com/s", ...fields });
  const a = { id: "a", name: "First songs" };
  const b = { id: "b", name: "Second songs" };
  const deezer = {
    title: "Amazing Grace",
    artist: "Example Choir",
    album: "Hymns",
    releaseDate: "2013-05-01",
    artworkUrl: "https://e-cdns-images.dzcdn.net/1.jpg",
    thumbnailUrl: "https://e-cdns-images.dzcdn.net/1s.jpg",
    sources: [{ provider: "deezer" as const, id: "5001", url: "https://www.deezer.com/track/5001" }],
  };

  it("one row per song from every server, its versions best rated first, weighed by how many rated", () => {
    const rows = chordSongs([
      {
        provider: a,
        songs: [
          song({
            id: "1",
            title: "Amazing Grace",
            artists: ["Example Choir"],
            versions: [
              { id: "simple", name: "Simplified", rating: { value: 4.2, count: 15 } },
              { id: "unrated", name: "Capo 2", capo: 2 },
              { id: "original", rating: { value: 4.7, count: 120 }, source: { name: "Example Chords" } },
            ],
          }),
          song({ id: "2", title: "No chords here", artists: [] }),
        ],
      },
      { provider: b, songs: [song({ id: "x", title: "Amazing grace!", artists: ["Example choir"], key: "D", hasContent: true }), song({ id: "y", title: "Holy", artists: [], versions: [{ id: "one", rating: { value: 5, count: 1 } }] })] },
    ]);
    expect(rows.map((row) => row.title)).toEqual(["Amazing Grace", "Holy"]);
    expect(rows[0]!.versions.map((v) => `${v.providerId}:${v.versionId}`)).toEqual(["a:original", "a:simple", "a:unrated", "b:null"]);
    expect(rows[0]!.versions[0]).toMatchObject({ source: { name: "Example Chords", url: null }, songId: "1" });
    expect(rows[0]!.versions[3]).toMatchObject({ key: "D", rating: null });
    // One 5-star vote: below 4.7 from 120, above none.
    expect(ratingScore({ value: 5, count: 1 })).toBeLessThan(ratingScore({ value: 4.7, count: 120 }));
    expect(ratingScore(null)).toBeLessThan(ratingScore({ value: 0, count: 0 }));
  });

  it("paired with the music services' match of the same song and artist, never a karaoke one", () => {
    const answers = [{ provider: a, songs: [song({ id: "1", title: "Amazing Grace", artists: ["Example Choir"], hasContent: true })] }];
    const karaoke = { ...deezer, title: "Amazing Grace (Karaoke Version)", sources: [{ provider: "spotify" as const, id: "k", url: "https://open.spotify.com/track/k" }] };
    const other = { ...deezer, artist: "Someone else", sources: [{ provider: "apple_music" as const, id: "o", url: "https://music.apple.com/o" }] };
    const [row] = chordSongs(answers, [karaoke, other, deezer]);
    expect(row!.match?.sources.map((s) => `${s.provider}:${s.id}`)).toEqual(["deezer:5001", "song_providers:a:1"]);
    expect(row).toMatchObject({ album: "Hymns", releaseDate: "2013-05-01", thumbnailUrl: deezer.thumbnailUrl });
    expect(chordSongs(answers, [karaoke, other])[0]!.match).toBeNull();
  });
});
