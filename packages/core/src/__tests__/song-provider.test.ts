import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import {
  readSongProviderSourceId,
  SongProviderContentSchema,
  SongProviderSongSchema,
  SongProviderSearchResultSchema,
  songProviderSourceId,
} from "../song-provider/index.js";
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
