import { describe, expect, it } from "vite-plus/test";
import { parseChordsOverLyrics } from "../chords-over-lyrics/parser.js";

function lyrics(sections: ReturnType<typeof parseChordsOverLyrics>) {
  return sections.map((s) => s.lines.map((l) => l.segments.map((seg) => seg.lyric).join("")).join("\n")).join("\n---\n");
}

function chords(sections: ReturnType<typeof parseChordsOverLyrics>) {
  return sections
    .map((s) =>
      s.lines.map((l) => l.segments.map((seg) => seg.chord?.raw ?? null).filter((c) => c !== null)).flat(),
    )
    .flat();
}

describe("parseChordsOverLyrics", () => {
  it("overlays a chord line onto the lyric line beneath it at matching columns", () => {
    const sections = parseChordsOverLyrics("G          C\nHow sweet the sound");

    expect(chords(sections)).toEqual(["G", "C"]);
    expect(lyrics(sections)).toBe("How sweet the sound");
  });

  it("places each chord immediately before the column it sits above", () => {
    const sections = parseChordsOverLyrics("G   C\nOnce upon");
    const segs = sections[0]?.lines[0]?.segments ?? [];
    const rendered = segs.map((s) => `${s.chord ? `[${s.chord.raw}]` : ""}${s.lyric}`).join("");
    expect(rendered).toBe("[G]Once[C] upon");
  });

  it("recognizes a plain-text section label and starts a new section", () => {
    const sections = parseChordsOverLyrics("Verse 1\nG\nLine one\n\nChorus\nC\nLine two");
    expect(sections).toHaveLength(2);
    expect(sections[0]?.type).toBe("verse");
    expect(sections[1]?.type).toBe("chorus");
  });

  it("handles a chord line with no lyric line under it (instrumental)", () => {
    const sections = parseChordsOverLyrics("G C G D");
    expect(chords(sections)).toEqual(["G", "C", "G", "D"]);
    // As far apart as written (issue #344): spaces under them, no words.
    expect(lyrics(sections).trim()).toBe("");
  });

  it("treats a line that isn't all chord tokens as lyrics, not chords", () => {
    const sections = parseChordsOverLyrics("This is just a plain lyric line");
    expect(chords(sections)).toEqual([]);
    expect(lyrics(sections)).toBe("This is just a plain lyric line");
  });

  it("round-trips slash chords and extensions", () => {
    const sections = parseChordsOverLyrics("D/F#      Csus4   Am7\nWords here today");
    expect(chords(sections)).toEqual(["D/F#", "Csus4", "Am7"]);
  });
});
