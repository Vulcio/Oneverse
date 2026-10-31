import { describe, expect, it } from "vite-plus/test";
import { cueAt, cueSectionsOf, nextCueSection, sectionsFromText, snapToBeat, sortedCues, structureGroupOf, type SectionType } from "../index.js";

const doc = {
  sections: [
    { id: "v1", type: "verse" as const, label: null, showLabel: true, lines: [] },
    { id: "ch", type: "chorus" as const, label: null, showLabel: true, lines: [] },
    { id: "v2", type: "verse" as const, label: null, showLabel: true, lines: [] },
    { id: "tag", type: "tag" as const, label: "Tag", showLabel: true, lines: [] },
  ],
  flow: [
    { id: "p1", sectionId: "v1" },
    { id: "p2", sectionId: "ch" },
    { id: "p3", sectionId: "v2" },
    { id: "p4", sectionId: "ch" },
  ],
};

describe("cue points (issue #110)", () => {
  it("names the sections as the structure bar does: verses numbered by where they're written, listed in the order sung; the order as section IDs", () => {
    const { sections, flow } = cueSectionsOf(doc);
    expect(sections.map((section) => [section.id, section.number, section.group])).toEqual([
      ["v1", 1, "verse"],
      ["ch", null, "chorus"],
      ["v2", 2, "verse"],
      ["tag", null, "edge"],
    ]);
    expect(flow).toEqual(["v1", "ch", "v2", "ch"]);
  });

  it("in time order, a section the song no longer has left out; the one playing at a time", () => {
    const cues = sortedCues(
      [
        { at: 30, sectionId: "ch" },
        { at: 0, sectionId: "v1" },
        { at: 50, sectionId: "gone" },
      ],
      doc.sections,
    );
    expect(cues.map((cue) => cue.sectionId)).toEqual(["v1", "ch"]);
    expect([cueAt(cues, 10), cueAt(cues, 30), cueAt([{ at: 5, sectionId: "v1" }], 2)]).toEqual([0, 1, null]);
  });

  it("tapping along places the song's order in turn, then the last section again", () => {
    const { flow } = cueSectionsOf(doc);
    expect(nextCueSection(flow, [])).toBe("v1");
    expect(nextCueSection(flow, [{ at: 0, sectionId: "v1" }, { at: 10, sectionId: "ch" }])).toBe("v2");
    expect(nextCueSection(flow, Array.from({ length: 6 }, (_, i) => ({ at: i, sectionId: "x" })))).toBe("ch");
  });

  it("snaps to the nearest beat of the recording", () => {
    expect(snapToBeat(12.3, { tempo: 120, firstBeat: 0.25 })).toBeCloseTo(12.25);
    expect(snapToBeat(12.3, null)).toBe(12.3);
    expect(snapToBeat(0.1, { tempo: 60, firstBeat: 0.5 })).toBe(0.5);
  });
});

describe("vamp, breakdown and interlude (issue #143)", () => {
  it("are section types ChordPro reads, as directives and as label lines, coloured like a bridge or an instrumental", () => {
    const sections = sectionsFromText("{start_of_vamp}\n[G]Again\n{end_of_vamp}\n\nInterlude:\n[C] [D]\n\n[Breakdown]\n[Em]Down\n", "chordpro");
    expect(sections.map((section) => section.type)).toEqual(["vamp", "interlude", "breakdown"]);
    expect(["vamp", "breakdown", "interlude"].map((type) => structureGroupOf(type as SectionType))).toEqual(["bridge", "instrumental", "instrumental"]);
  });
});
