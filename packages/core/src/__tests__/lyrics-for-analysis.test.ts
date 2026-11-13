import { describe, expect, it } from "vite-plus/test";
import { cuesFromHints, lyricsForAnalysis, songFromText } from "../index.js";

const song = songFromText("{start_of_verse}\n[G]Amazing grace\nHow [D]sweet\n{end_of_verse}\n\n{start_of_chorus}\n[C]My chains are gone\n{end_of_chorus}\n\n{start_of_verse}\n[G]Twas grace\n{end_of_verse}\n\n{start_of_other: Spoken}\nListen\n{end_of_other}\n", "CHORDPRO");

describe("the song's words for the analysis server (issue #450)", () => {
  it("one block per pass in the order sung, named by kind in English and numbered, chords inline; the section each pass sings", () => {
    const doc = { ...song, flow: [...song.flow.slice(0, 3), song.flow[1]!, song.flow[3]!] };
    const words = lyricsForAnalysis(doc)!;
    expect(words.text).toBe("{c: Verse 1}\n[G]Amazing grace\nHow [D]sweet\n\n{c: Chorus}\n[C]My chains are gone\n\n{c: Verse 2}\n[G]Twas grace\n\n{c: Chorus}\n[C]My chains are gone\n\n{c: Spoken}\nListen\n");
    expect(words.passes).toEqual(doc.flow.map((pass) => pass.sectionId));
  });

  it("nothing to send for a song without sections", () => {
    expect(lyricsForAnalysis({ sections: [], flow: [] })).toBeNull();
  });

  it("cue points from the passes the server placed: a section sung once more keeps its pass, a stretch without a hint is left out", () => {
    const passes = song.flow.map((pass) => pass.sectionId);
    const cues = cuesFromHints(
      [
        { start: 0, hint: undefined },
        { start: 8.304, hint: 0 },
        { start: 40.1, hint: 1 },
        { start: 60, hint: 1 },
        { start: 70, hint: 9 },
      ],
      passes,
      song,
    );
    expect(cues).toEqual([
      { at: 8.3, sectionId: passes[0] },
      { at: 40.1, sectionId: passes[1] },
      { at: 60, sectionId: passes[1] },
    ]);
  });
});
