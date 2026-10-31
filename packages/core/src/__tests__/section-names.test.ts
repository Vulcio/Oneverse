import { describe, expect, it } from "vite-plus/test";
import { isPlainLabel, passName, renderChart, sectionName, sectionNumbers, songFromText, withoutPlainLabels, type SectionType } from "../index.js";

const names: Record<string, string> = { verse: "Verse", chorus: "Chorus", bridge: "Bridge" };
const typeName = (type: SectionType) => names[type] ?? type;
const section = (id: string, type: SectionType, label: string | null = null) => ({ id, type, label, showLabel: true, lines: [] });

describe("section names (issue #344)", () => {
  const sections = [section("v1", "verse"), section("c1", "chorus"), section("v2", "verse"), section("b", "bridge"), section("o", "other")];

  it("numbers a type by where it's written, only when the song has more than one", () => {
    const numbers = sectionNumbers(sections);
    expect([...numbers]).toEqual([
      ["v1", 1],
      ["c1", null],
      ["v2", 2],
      ["b", null],
      ["o", null],
    ]);
    expect(sections.map((one) => sectionName(one, numbers.get(one.id), typeName))).toEqual(["Verse 1", "Chorus", "Verse 2", "Bridge", null]);
  });

  it("two choruses are Chorus 1 and Chorus 2; a label of its own wins", () => {
    const two = [section("c1", "chorus"), section("c2", "chorus"), section("c3", "chorus", "Final chorus")];
    const numbers = sectionNumbers(two);
    expect(two.map((one) => sectionName(one, numbers.get(one.id), typeName))).toEqual(["Chorus 1", "Chorus 2", "Final chorus"]);
  });

  it("a pass sung again is named as the section it sings, unless it has a label", () => {
    const numbers = sectionNumbers(sections);
    expect(passName({}, sections[2]!, numbers.get("v2"), typeName)).toBe("Verse 2");
    expect(passName({ label: "Last time" }, sections[1]!, numbers.get("c1"), typeName)).toBe("Last time");
  });

  it("a label that only says the name is plain: its type, in any language, with no number or its own", () => {
    expect(isPlainLabel("Verse 2", { type: "verse" }, 2)).toBe(true);
    expect(isPlainLabel("Refrain", { type: "chorus" }, null)).toBe(true);
    expect(isPlainLabel("Chorus 1", { type: "chorus" }, null)).toBe(true);
    expect(isPlainLabel("Strophe 3", { type: "verse" }, 2)).toBe(false);
    expect(isPlainLabel("Verse 2a", { type: "verse" }, 2)).toBe(false);
    expect(isPlainLabel("Bridge", { type: "chorus" }, null)).toBe(false);
    expect(isPlainLabel("Chorus 2", { type: "chorus" }, null)).toBe(false);
    expect(isPlainLabel("Chorus 2", { type: "chorus" }, null, true)).toBe(true);
  });

  it("drops plain labels from sections and passes, keeps the others", () => {
    const doc = withoutPlainLabels({
      sections: [section("v1", "verse", "Verse 1"), section("c", "chorus", "Chorus"), section("v2", "verse", "Verse 2"), section("t", "tag", "Big ending")],
      flow: [
        { id: "p1", sectionId: "v1" },
        { id: "p2", sectionId: "c" },
        { id: "p3", sectionId: "v2" },
        { id: "p4", sectionId: "c", label: "Chorus 2" },
        { id: "p5", sectionId: "t", label: "Big ending" },
      ],
    });
    expect(doc.sections.map((one) => one.label)).toEqual([null, null, null, "Big ending"]);
    expect(doc.flow.map((item) => item.label ?? null)).toEqual([null, null, null, null, null]);
  });

  it("imported text: numbered headings become the rule's names; the chart numbers them", () => {
    const text = "Verse 1\nAmazing grace\n\nChorus\nMy chains are gone\n\nVerse 2\nTwas grace\n\nChorus\nMy chains are gone\n";
    const song = songFromText(text, "CHORDS_OVER_LYRICS", { mergeRepeats: true });
    expect(song.sections.map((one) => [one.type, one.label])).toEqual([
      ["verse", null],
      ["chorus", null],
      ["verse", null],
    ]);
    const chart = renderChart({ $schema: "song-document/v2", revision: 1, defaults: {}, sections: song.sections, flow: song.flow });
    expect(chart.passes.map((pass) => passName(pass, pass.section, pass.section.number, typeName))).toEqual(["Verse 1", "Chorus", "Verse 2", "Chorus"]);
  });
});
