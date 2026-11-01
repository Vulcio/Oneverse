import { describe, expect, it } from "vite-plus/test";
import { confidentMatch, songInfoProposals, type SongInfoCurrent } from "../metadata/proposals.js";
import type { MetadataMatch } from "../schemas/metadata.js";

const match = (details: Partial<MetadataMatch> = {}): MetadataMatch => ({
  title: "Oceans (Where Feet May Fail)",
  artist: "Hillsong United",
  album: "Zion",
  releaseDate: "2013-02-22",
  artworkUrl: "https://example.com/art.jpg",
  thumbnailUrl: null,
  isrc: "AU-ABC-13-00001",
  composers: ["Joel Houston", "Matt Crocker", "Salomon Ligthelm"],
  tempo: 65.8,
  durationSeconds: 534,
  sources: [{ provider: "deezer", id: "1", url: "https://www.deezer.com/track/1" }],
  ...details,
});

const empty: SongInfoCurrent = { title: "Oceans", artists: [], writers: [], album: null, year: null, isrc: null, tempo: null, durationSeconds: null, hasImage: false };

describe("songInfoProposals", () => {
  it("fills what the song doesn't have, ticked", () => {
    const proposals = songInfoProposals(empty, match());
    expect(proposals.map((p) => p.field)).toEqual(["artists", "writers", "album", "year", "isrc", "tempo", "duration", "artwork"]);
    expect(proposals.every((p) => p.fillsEmpty)).toBe(true);
    expect(proposals.find((p) => p.field === "year")?.proposed).toBe(2013);
    expect(proposals.find((p) => p.field === "isrc")?.proposed).toBe("AUABC1300001");
    expect(proposals.find((p) => p.field === "tempo")?.proposed).toBe(66);
  });

  it("lists something else as a change, not ticked, and leaves out what's the same", () => {
    const proposals = songInfoProposals({ ...empty, album: "Zion (Deluxe)", year: 2012, artists: ["hillsong united"], hasImage: true }, match());
    expect(proposals.find((p) => p.field === "artists")).toBeUndefined();
    expect(proposals.find((p) => p.field === "album")).toBeUndefined();
    expect(proposals.find((p) => p.field === "year")).toMatchObject({ current: 2012, proposed: 2013, fillsEmpty: false });
    expect(proposals.find((p) => p.field === "artwork")).toMatchObject({ current: true, fillsEmpty: false });
  });

  it("says nothing of what the match doesn't know", () => {
    const proposals = songInfoProposals(empty, match({ tempo: null, durationSeconds: undefined, composers: undefined, isrc: null, artworkUrl: null }));
    expect(proposals.map((p) => p.field)).toEqual(["artists", "album", "year"]);
  });
});

describe("confidentMatch", () => {
  it("takes the first match with the same title and artist", () => {
    expect(confidentMatch([match()], "Oceans", "Hillsong United")).not.toBeNull();
  });
  it("not without an artist, another artist, or a karaoke version", () => {
    expect(confidentMatch([match()], "Oceans", null)).toBeNull();
    expect(confidentMatch([match()], "Oceans", "Someone Else")).toBeNull();
    expect(confidentMatch([match({ title: "Oceans (Karaoke Version)" })], "Oceans", "Hillsong United")).toBeNull();
  });
});
