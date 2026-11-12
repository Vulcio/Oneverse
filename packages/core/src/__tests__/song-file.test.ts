import { describe, expect, it } from "vite-plus/test";
import { isChordsOnly } from "../chords/chord-token.js";
import { headingWithContent, repeatCall } from "../chordpro/section-labels.js";
import { decodeSongFile } from "../import-detection/decode.js";
import { detectImportFormat } from "../import-detection/detect-format.js";
import { isLrc, lrcToText } from "../import-detection/lrc.js";
import { readSongFile, titleFromFileName } from "../import-detection/song-details.js";

// Messy song files (issue #438).
describe("lines of chords", () => {
  it("knows chords of every kind, and the marks around them", () => {
    for (const line of ["F#7sus4 G(add9) Em7b5", "D6/9  E7b9  A7#9  Gm(maj7)", "B°  Bø  C+  Dmaj9", "(G)   (C)", "G - D - Em - C", "G D Em C (x2)", "G D Em C (x 2)", "N.C.  G", "Do  G"]) {
      expect(isChordsOnly(line), line).toBe(true);
    }
  });
  it("leaves words alone", () => {
    for (const line of ["Amazing grace", "A wretch like me", "Do", "Ad", "x2", "-", "G D Em C hello"]) expect(isChordsOnly(line), line).toBe(false);
  });
});

describe("headings", () => {
  it("reads a section called again", () => {
    expect(repeatCall("(Repeat Chorus)")).toEqual({ type: "chorus", number: null, times: 1 });
    expect(repeatCall("Chorus x2")).toEqual({ type: "chorus", number: null, times: 2 });
    expect(repeatCall("Refrain (bis)")).toEqual({ type: "chorus", number: null, times: 2 });
    expect(repeatCall("Reprendre le refrain")).toEqual({ type: "chorus", number: null, times: 1 });
    expect(repeatCall("Verse 2 x2")).toEqual({ type: "verse", number: "2", times: 2 });
    expect(repeatCall("Chorus")).toBeNull();
    expect(repeatCall("[Chorus]")).toBeNull();
    expect(repeatCall("Repeat after me")).toBeNull();
  });
  it("splits a heading from the words after it", () => {
    expect(headingWithContent("Verse 1: Amazing grace")).toEqual({ heading: "Verse 1", rest: "Amazing grace" });
    expect(headingWithContent("[Intro] G D Em C")).toEqual({ heading: "[Intro]", rest: "G D Em C" });
    expect(headingWithContent("[C]Hello")).toBeNull();
    expect(headingWithContent("Chorus:")).toBeNull();
  });
});

describe("a song file's bytes", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  it("reads UTF-8, with or without its mark", () => {
    expect(decodeSongFile(new TextEncoder().encode("Refrain : élevé"))).toBe("Refrain : élevé");
    expect(decodeSongFile(bytes(0xef, 0xbb, 0xbf, 0x47))).toBe("G");
  });
  it("reads an old Windows file", () => {
    // "Pont élevé" in Windows-1252.
    expect(decodeSongFile(bytes(0x50, 0x6f, 0x6e, 0x74, 0x20, 0xe9, 0x6c, 0x65, 0x76, 0xe9))).toBe("Pont élevé");
  });
  it("reads UTF-16, with or without its mark", () => {
    expect(decodeSongFile(bytes(0xff, 0xfe, 0x47, 0, 0xe9, 0))).toBe("Gé");
    expect(decodeSongFile(bytes(0, 0x47, 0, 0x6f, 0, 0x64, 0, 0x20))).toBe("God ");
    expect(decodeSongFile(bytes(0x47, 0, 0x6f, 0, 0x64, 0, 0x20, 0))).toBe("God ");
  });
  it("refuses a file that isn't text", () => {
    expect(decodeSongFile(bytes(0x0a, 0x12, 0x08, 0x00, 0x01, 0x02, 0x03, 0x88, 0x00, 0x00, 0x12))).toBeNull();
  });
});

describe("LRC files", () => {
  const lrc = "[ti:Amazing Grace]\n[ar:John Newton & Others]\n[00:12.34]Amazing grace\n[00:15.00]<00:15.00>How <00:15.50>sweet\n[00:30.00][00:18.00]The sound\n";
  it("is told apart from ChordPro", () => {
    expect(isLrc(lrc)).toBe(true);
    expect(isLrc("[G]Amazing [C]grace\n[D]How sweet\n")).toBe(false);
    expect(detectImportFormat(lrc)).toBe("RAW_TEXT");
  });
  it("gives its words in the order they're sung, and its tags", () => {
    expect(lrcToText(lrc)).toEqual({ text: "Amazing grace\nHow sweet\nThe sound\n\nThe sound", details: { title: "Amazing Grace", artist: "John Newton & Others" } });
  });
});

describe("a song file's details", () => {
  it("reads ChordPro's directives", () => {
    const { details, body } = readSongFile("{t: Holy}\n{artist: A, B}\n{key: F# minor}\n{tempo: 92 bpm}\n{time: 6/8}\n{capo: 3}\n{meta: year 1861}\n[D]Holy");
    expect(details).toMatchObject({ title: "Holy", artists: ["A", "B"], key: "F#m", tempo: 92, timeSignature: "6/8", capo: 3, year: 1861 });
    expect(body).toContain("{t: Holy}");
  });
  it("reads a plain file's first lines, and leaves them out of the chart", () => {
    const { details, body } = readSongFile("Amazing Grace\nJohn Newton\nKey: G\nCapo 2nd fret\nTempo: 72\nCCLI Song # 4768151\n\nVerse 1:\nAmazing grace\n");
    expect(details).toMatchObject({ title: "Amazing Grace", artists: ["John Newton"], key: "G", capo: 2, tempo: 72, ccli: "4768151" });
    expect(body.trim()).toBe("Verse 1:\nAmazing grace");
  });
  it("leaves the words of a file without details alone", () => {
    const text = "Amazing grace how sweet the sound\nThat saved a wretch like me\n\nChorus\nMy chains are gone\n";
    expect(readSongFile(text)).toEqual({ details: { artists: [], composers: [], lyricists: [], writers: [] }, body: text });
  });
  it("takes a title from the file's name", () => {
    expect(titleFromFileName("amazing_grace.cho")).toBe("Amazing grace");
    expect(titleFromFileName("C:\\songs\\It Is Well-Spafford.chordpro")).toBe("It Is Well - Spafford");
  });
});
