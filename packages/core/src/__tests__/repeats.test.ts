import { describe, expect, it } from "vite-plus/test";
import type { ArrangementDocumentV2 } from "../schemas/arrangement-document-v2.js";
import type { SectionV2, SongDocumentV2 } from "../schemas/song-document-v2.js";
import { findRepeats, linkRepeat, linkRepeatInArrangement, matchRepeat } from "../song-document/repeats.js";

const section = (id: string, chords: string[], type: SectionV2["type"] = "chorus", label: string | null = null): SectionV2 => ({
  id,
  type,
  label,
  lines: [
    { id: `${id}_l1`, kind: "lyric", text: "Holy, holy", chords: [{ id: `${id}_c1`, at: 0, raw: chords[0]! }, { id: `${id}_c2`, at: 7, raw: chords[1]! }] },
    { id: `${id}_l2`, kind: "lyric", text: "Lord God almighty", chords: [{ id: `${id}_c3`, at: 0, raw: chords[2]! }, { id: `${id}_c4`, at: 9, raw: chords[3]! }] },
  ],
});
const song = (sections: SectionV2[], flow: SongDocumentV2["flow"]): SongDocumentV2 => ({ $schema: "song-document/v2", revision: 4, defaults: { key: "G" }, sections, flow });

describe("matchRepeat (issue #231)", () => {
  it("another key and one chord of its own: transposed, with that chord written in the song's key", () => {
    const found = matchRepeat(section("a", ["G", "D", "Em", "C"]), section("b", ["A", "E", "F#m", "Bm"]), "G");
    expect(found?.match).toEqual({ kind: "chords", steps: 2, chords: [{ chordId: "a_c4", raw: "Am" }] });
  });

  it("other words, or another kind of section: not a repeat", () => {
    const other = section("b", ["G", "D", "Em", "C"]);
    other.lines[0]!.text = "Holy, holy, holy";
    expect(matchRepeat(section("a", ["G", "D", "Em", "C"]), other, "G")).toBeNull();
    expect(matchRepeat(section("a", ["G", "D", "Em", "C"]), section("b", ["G", "D", "Em", "C"], "verse"), "G")).toBeNull();
  });

  it("spelt differently but the same chords: the same", () => {
    expect(matchRepeat(section("a", ["G", "D", "Em", "C#"]), section("b", ["G", "D", "Em", "Db"]), "G")?.match).toEqual({ kind: "same" });
  });
});

describe("linkRepeat", () => {
  const doc = song([section("a", ["G", "D", "Em", "C"]), section("b", ["A", "E", "F#m", "D"], "chorus", "Last chorus")], [
    { id: "f1", sectionId: "a" },
    // The repeat had its own changes: a chord, and a step further up.
    { id: "f2", sectionId: "b", transpose: 1, chords: [{ chordId: "b_c2", raw: "E7" }] },
  ]);
  const [repeat] = findRepeats(doc);

  it("its passes keep what they had: transpositions add up, its own chords back in the song's key", () => {
    const linked = linkRepeat(doc, repeat!);
    expect(linked.sections.map((one) => one.id)).toEqual(["a"]);
    expect(linked.flow[1]).toEqual({ id: "f2", sectionId: "a", label: "Last chorus", transpose: 3, chords: [{ chordId: "a_c2", raw: "D7" }] });
    expect(linked.revision).toBe(5);
  });

  it("an arrangement's passes of the repeat follow, its overrides on the earlier section's chords", () => {
    const arrangement: ArrangementDocumentV2 = {
      $schema: "arrangement-document/v2",
      songVersionId: "song1",
      songRevision: 4,
      defaults: {},
      items: [
        { id: "i1", sectionId: "a", overrides: [] },
        { id: "i2", sectionId: "b", overrides: [{ type: "hide_chord", chordId: "b_c3" }] },
      ],
    } as ArrangementDocumentV2;
    const linked = linkRepeatInArrangement(arrangement, repeat!, "G");
    expect(linked.songRevision).toBe(4);
    expect(linked.items[0]).toEqual(arrangement.items[0]);
    expect(linked.items[1]).toMatchObject({ sectionId: "a", transpose: 2, label: "Last chorus", overrides: [{ type: "hide_chord", chordId: "a_c3" }] });
  });
});
