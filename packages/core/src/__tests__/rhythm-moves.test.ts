import { describe, expect, test } from "vite-plus/test";
import { copyRhythmPlacement, editableRhythm, isKeyChord, lineBars, matchingSections, moveChordInRhythm, nudgeChordInRhythm, pinRhythmChord, samePlacement, setRhythmBarCount, type Rhythm } from "../index.js";

// A verse in 4/4: C on "When", F on "river", C on "tendeth" (beat 3), Am on "sorrows" - four bars.
const verse = {
  lines: [
    { id: "l1", kind: "lyric" as const, text: "When peace like a river attendeth my way", chords: [{ id: "c1", at: 0, raw: "C" }, { id: "c2", at: 17, raw: "F" }, { id: "c3", at: 23, raw: "C" }] },
    { id: "l2", kind: "lyric" as const, text: "When sorrows like sea billows roll", chords: [{ id: "c4", at: 5, raw: "Am" }, { id: "c5", at: 22, raw: "G" }] },
  ],
};
const rhythm: Rhythm = {
  beatsPerBar: null,
  bars: [
    { chords: [{ chordId: "c1", beat: 1 }], lyricAnchor: { lineId: "l1", at: 0 } },
    { chords: [{ chordId: "c2", beat: 1 }, { chordId: "c3", beat: 3 }] },
    { chords: [{ chordId: "c4", beat: 1 }], lyricAnchor: { lineId: "l2", at: 0 } },
    { chords: [{ chordId: "c5", beat: 1 }] },
  ],
};
const at = (r: Rhythm) => r.bars.map((bar) => bar.chords.map((chord) => `${chord.chordId}@${chord.beat}${chord.pinned === undefined ? "" : chord.pinned ? "!" : "~"}`).join(" "));

describe("isKeyChord", () => {
  test("beat 1 unless unpinned; others when pinned", () => {
    expect(isKeyChord({ beat: 1 })).toBe(true);
    expect(isKeyChord({ beat: 3 })).toBe(false);
    expect(isKeyChord({ beat: 1, pinned: false })).toBe(false);
    expect(isKeyChord({ beat: 2.5, pinned: true })).toBe(true);
  });
});

describe("moveChordInRhythm, in place", () => {
  test("a chord between key chords moves alone and becomes one", () => {
    const move = moveChordInRhythm(verse, rhythm, "c3", 1, 4, "inPlace");
    if (!move.ok) throw new Error(move.problem);
    expect(at(move.rhythm)).toEqual(["c1@1", "c2@1 c3@4!", "c4@1", "c5@1"]);
    expect(move.moved).toEqual([]);
  });
  test("can't pass a key chord", () => {
    expect(moveChordInRhythm(verse, rhythm, "c3", 2, 2, "inPlace")).toEqual({ ok: false, problem: "pinned", chordId: "c4" });
  });
  test("a key chord moved: the chords up to the next key chord spread evenly", () => {
    const unpinned = pinRhythmChord(rhythm, "c4", false)!;
    // F to beat 3 of bar 1; C (beat 3 of bar 2) and Am (no longer a key chord) spread up to G in bar 4.
    const move = moveChordInRhythm(verse, unpinned, "c2", 0, 3, "inPlace");
    if (!move.ok) throw new Error(move.problem);
    expect(at(move.rhythm)).toEqual(["c1@1 c2@3!", "c3@2", "c4@2", "c5@1"]);
    expect(move.moved).toEqual(["c3", "c4"]);
  });
  test("no room on whole beats: halves; none at all: refused", () => {
    const tight: Rhythm = { beatsPerBar: null, bars: [{ chords: [{ chordId: "c1", beat: 1 }, { chordId: "c2", beat: 2 }, { chordId: "c3", beat: 3 }] }, { chords: [{ chordId: "c4", beat: 1 }] }, { chords: [] }, { chords: [{ chordId: "c5", beat: 1 }] }] };
    const halves = moveChordInRhythm(verse, tight, "c2", 0, 4, "inPlace");
    if (!halves.ok) throw new Error(halves.problem);
    expect(at(halves.rhythm)[0]).toBe("c1@1 c2@4! c3@4.5");
    expect(moveChordInRhythm(verse, tight, "c2", 0, 4.5, "inPlace")).toEqual({ ok: false, problem: "room" });
  });
  test("outside the section", () => {
    expect(moveChordInRhythm(verse, rhythm, "c3", 9, 1, "inPlace")).toEqual({ ok: false, problem: "outside" });
    expect(nudgeChordInRhythm(verse, rhythm, "c5", 4, "inPlace")).toEqual({ ok: false, problem: "outside" });
  });
});

describe("moveChordInRhythm, ripple", () => {
  test("everything after moves as much, bars added at the end, words with their chords", () => {
    const move = moveChordInRhythm(verse, rhythm, "c3", 1, 4, "ripple");
    if (!move.ok) throw new Error(move.problem);
    expect(move.by).toBe(1);
    expect(move.bars).toBe(1);
    expect(move.moved).toEqual(["c4", "c5"]);
    // Am and G after a beat, off their beat 1 (no longer key chords but kept as such).
    expect(at(move.rhythm)).toEqual(["c1@1", "c2@1 c3@4!", "c4@2!", "c5@2!", ""]);
    // The second line now starts in the bar its first chord is in.
    expect(move.rhythm.bars[2]!.lyricAnchor).toEqual({ lineId: "l2", at: 0 });
  });
  test("by a whole bar: key chords keep their beat", () => {
    const move = nudgeChordInRhythm(verse, rhythm, "c4", 4, "ripple");
    if (!move.ok) throw new Error(move.problem);
    expect(at(move.rhythm)).toEqual(["c1@1", "c2@1 c3@3", "", "c4@1", "c5@1"]);
    expect(move.rhythm.bars[3]!.lyricAnchor).toEqual({ lineId: "l2", at: 0 });
    expect(move.rhythm.bars[2]!.lyricAnchor).toBe(null);
  });
  test("earlier: bars taken off the end, never past the chord before", () => {
    const later = nudgeChordInRhythm(verse, rhythm, "c4", 4, "ripple");
    if (!later.ok) throw new Error(later.problem);
    const back = nudgeChordInRhythm(verse, later.rhythm, "c4", -4, "ripple");
    if (!back.ok) throw new Error(back.problem);
    expect(at(back.rhythm)).toEqual(["c1@1", "c2@1 c3@3", "c4@1", "c5@1"]);
    expect(moveChordInRhythm(verse, rhythm, "c4", 1, 2, "ripple")).toEqual({ ok: false, problem: "order", chordId: "c3" });
  });
});

describe("sections", () => {
  const verse2 = {
    id: "v2",
    lines: [
      { id: "m1", kind: "lyric" as const, text: "Though Satan should buffet though trials should come", chords: [{ id: "d1", at: 0, raw: "C" }, { id: "d2", at: 20, raw: "F" }, { id: "d3", at: 34, raw: "C" }] },
      { id: "m2", kind: "lyric" as const, text: "Let this blest assurance control", chords: [{ id: "d4", at: 4, raw: "Am" }, { id: "d5", at: 24, raw: "G" }] },
    ],
  };
  const copy = { id: "v1b", lines: verse.lines.map((line) => ({ ...line, id: `${line.id}b`, chords: line.chords.map((chord) => ({ ...chord, id: `${chord.id}b` })) })) };
  const chorus = { id: "ch", lines: [{ id: "k1", kind: "lyric" as const, text: "It is well", chords: [{ id: "e1", at: 0, raw: "F" }] }] };
  test("the same chords and words, or other words", () => {
    expect(matchingSections([{ id: "v1", ...verse }, verse2, copy, chorus], "v1")).toEqual([
      { sectionId: "v2", same: "chords" },
      { sectionId: "v1b", same: "words" },
    ]);
  });
  test("a placement given to the other verse, line for line", () => {
    const moved = moveChordInRhythm(verse, rhythm, "c3", 1, 4, "inPlace");
    if (!moved.ok) throw new Error(moved.problem);
    const given = copyRhythmPlacement(verse, moved.rhythm, verse2)!;
    expect(at(given)).toEqual(["d1@1", "d2@1 d3@4!", "d4@1", "d5@1"]);
    expect(given.bars[2]!.lyricAnchor).toEqual({ lineId: "m2", at: 0 });
    expect(samePlacement(verse, moved.rhythm, verse2, given)).toBe(true);
    expect(samePlacement(verse, rhythm, verse2, given)).toBe(false);
    expect(copyRhythmPlacement(verse, rhythm, chorus)).toBe(null);
  });
});

describe("setRhythmBarCount", () => {
  test("bars added at the end, empty ones taken off, not ones with chords", () => {
    expect(setRhythmBarCount(rhythm, 6)!.bars.length).toBe(6);
    expect(setRhythmBarCount(setRhythmBarCount(rhythm, 6)!, 4)!.bars.length).toBe(4);
    expect(setRhythmBarCount(rhythm, 3)).toBe(null);
    expect(setRhythmBarCount(rhythm, 0)).toBe(null);
  });
  test("with the section: fewer bars share the chords out again, the words following (#475)", () => {
    // 16 beats into 12: c1 0, c2 4 -> 3, c3 6 -> 4.5 -> 5 (whole beats), c4 8 -> 6, c5 12 -> 9.
    const three = setRhythmBarCount(rhythm, 3, verse)!;
    // Key chords stay key chords (pinned where they left beat 1).
    expect(at(three)).toEqual(["c1@1 c2@4!", "c3@2 c4@3!", "c5@2!"]);
    // Line 2 starts where its first chord (Am) is now.
    expect(three.bars[0]!.lyricAnchor).toEqual({ lineId: "l1", at: 0 });
    expect(three.bars[1]!.lyricAnchor).toEqual({ lineId: "l2", at: 0 });
    // A line whose first chord ends up late in a bar starts at the next bar with one of its chords: its words before
    // that are sung at the end of the bar before.
    const late: Rhythm = { beatsPerBar: null, bars: [{ chords: [{ chordId: "c1", beat: 1 }, { chordId: "c2", beat: 2, pinned: true }] }, { chords: [{ chordId: "c3", beat: 2 }] }, { chords: [{ chordId: "c4", beat: 2, pinned: true }] }, { chords: [{ chordId: "c5", beat: 2, pinned: true }] }] };
    const squeezed = setRhythmBarCount(late, 3, verse)!;
    expect(at(squeezed)).toEqual(["c1@1 c2@2!", "c3@1~ c4@4!", "c5@3!"]);
    expect(squeezed.bars.map((bar) => bar.lyricAnchor)).toEqual([{ lineId: "l1", at: 0 }, { lineId: "l1", at: 18 }, { lineId: "l2", at: 22 }]);
    // Down to one bar: halves, then refused when even they don't fit.
    expect(at(setRhythmBarCount(rhythm, 1, verse)!)).toEqual(["c1@1 c2@2! c3@2.5 c4@3! c5@4!"]);
    const crowded = { lines: [{ id: "x", kind: "lyric" as const, text: "a b c d e f g h i", chords: "abcdefghi".split("").map((id, at) => ({ id, at: at * 2, raw: "C" })) }] };
    expect(setRhythmBarCount(editableRhythm(crowded), 1, crowded)).toBe(null);
  });
});

describe("filled in from the chart (#475)", () => {
  test("a sung line two bars, its chords shared, two a bar at most", () => {
    expect(lineBars(1, true)).toEqual([[{ chord: 0, beat: 1 }], []]);
    expect(lineBars(3, true)).toEqual([[{ chord: 0, beat: 1 }, { chord: 1, beat: 3 }], [{ chord: 2, beat: 1 }]]);
    expect(lineBars(4, true, 6)).toEqual([[{ chord: 0, beat: 1 }, { chord: 1, beat: 4 }], [{ chord: 2, beat: 1 }, { chord: 3, beat: 4 }]]);
    expect(lineBars(5, true).map((bar) => bar.length)).toEqual([2, 2, 1]);
    expect(lineBars(0, true)).toEqual([[], []]);
    expect(lineBars(3, false).length).toBe(3);
  });
  test("the verse: four bars, the first bar of a three-chord line taking two, words from where a bar's first chord is", () => {
    const filled = editableRhythm(verse);
    expect(at(filled)).toEqual(["c1@1 c2@3", "c3@1", "c4@1", "c5@1"]);
    expect(filled.bars.map((bar) => bar.lyricAnchor)).toEqual([{ lineId: "l1", at: 0 }, { lineId: "l1", at: 18 }, { lineId: "l2", at: 0 }, { lineId: "l2", at: 22 }]);
  });
});
