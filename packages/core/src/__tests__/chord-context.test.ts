import { describe, expect, test } from "vite-plus/test";
import { checkChartChords } from "../chords/context.js";

let ids = 0;
/** A section from lines of chords ("G C D G"), each chord on its own word. */
function section(type: string, ...lines: string[]) {
  const id = `sec_${++ids}`;
  return {
    id,
    type: type as "verse",
    lines: lines.map((chords, index) => {
      const raws = chords.split(" ").filter(Boolean);
      return {
        id: `${id}_l${index}`,
        text: raws.map(() => "word").join(" "),
        chords: raws.map((raw, at) => ({ id: `${id}_l${index}_c${at}`, raw, at: at * 5 })),
      };
    }),
  };
}

const flagged = (checks: ReturnType<typeof checkChartChords>) => checks.chords.map((one) => `${one.raw}:${one.reason.kind}:${one.suggestion ?? "-"}`);

describe("chords that seem out of context (issue #356)", () => {
  test("the key's own chords and the usual borrowed ones are fine", () => {
    const checks = checkChartChords({
      key: "G",
      sections: [section("verse", "G D Em C", "G/B C Am7 D7", "Cm G F C", "A7 D Eb F G"), section("chorus", "E7 Am C#dim D", "Gmaj7 Dsus4 D")],
    });
    expect(checks.chords).toEqual([]);
    expect(checks.keyCheck).toBeNull();
  });

  test("a chord outside the key, rare in the song, with its key's own chord on the same root", () => {
    const checks = checkChartChords({ key: "G", sections: [section("verse", "G D Em C", "G Dm7 C G"), section("chorus", "C D G Em", "C D G")] });
    expect(flagged(checks)).toEqual(["Dm7:outsideKey:D7"]);
    const reason = checks.chords[0]!.reason;
    expect(reason).toEqual({ kind: "outsideKey", key: "G", inKey: ["G", "Am", "Bm", "C", "D", "Em", "F#dim"], borrowed: ["F", "Eb", "Cm", "A", "B"], times: 1 });
  });

  test("a root off the key's scale: the key's chord a semitone away, when only one fits", () => {
    expect(flagged(checkChartChords({ key: "G", sections: [section("verse", "G C D G", "G#m D G")] }))).toEqual(["G#m:outsideKey:Am"]);
    expect(flagged(checkChartChords({ key: "G", sections: [section("verse", "G C D G", "C#m D G")] }))).toEqual(["C#m:outsideKey:-"]);
  });

  test("a chord outside the key that comes often is meant", () => {
    expect(checkChartChords({ key: "G", sections: [section("verse", "G C#m D G", "G C#m D G", "C#m D G")] }).chords).toEqual([]);
  });

  test("one chorus unlike every other: the chord the others have, even in the key", () => {
    const checks = checkChartChords({
      key: "D",
      sections: [section("verse", "D A Bm G"), section("chorus", "G D A D"), section("chorus", "G Bm A D"), section("chorus", "G D A D"), section("chorus", "G D A D")],
    });
    expect(flagged(checks)).toEqual(["Bm:unlikeOthers:D"]);
    expect(checks.chords[0]!.reason).toEqual({ kind: "unlikeOthers", sectionType: "chorus", others: 3, usual: "D" });
  });

  test("two sections differing say nothing about which is right", () => {
    expect(checkChartChords({ key: "D", sections: [section("chorus", "G D A D"), section("chorus", "G Bm A D")] }).chords).toEqual([]);
  });

  test("a key the chords mostly don't fit is said once, without a mark on each chord", () => {
    const checks = checkChartChords({ key: "Ab", sections: [section("verse", "D A Bm G", "D A G D"), section("chorus", "G D A Bm", "G D A D")] });
    expect(checks.keyCheck).toEqual({ written: "Ab", fits: "D", outsideWritten: 12, outsideFits: 0, total: 16 });
    expect(checks.chords).toEqual([]);
  });

  test("the relative minor isn't another key", () => {
    expect(checkChartChords({ key: "Em", sections: [section("verse", "G D Em C", "G D C G"), section("chorus", "C D G Em", "C D G")] }).keyCheck).toBeNull();
  });

  test("a song without a key is read in the key its chords fit", () => {
    const checks = checkChartChords({ key: null, sections: [section("verse", "A E F#m D", "A E D A"), section("chorus", "D E A Fm", "D E A")] });
    expect(checks.key).toBe("A");
    expect(checks.keyGuessed).toBe(true);
    expect(flagged(checks)).toEqual(["Fm:outsideKey:F#m"]);
  });

  test("too few chords to tell a key: nothing", () => {
    expect(checkChartChords({ key: null, sections: [section("verse", "A Fm D")] })).toEqual({ key: null, keyGuessed: false, keyCheck: null, chords: [] });
  });

  test("flat keys are spelled with flats; N.C. and what isn't a chord are left alone", () => {
    const checks = checkChartChords({ key: "F", sections: [section("verse", "F C Dm Bb", "N.C. F x2 C F", "F Gb C F")] });
    expect(flagged(checks)).toEqual(["Gb:outsideKey:F"]);
    expect(checks.chords[0]!.reason).toMatchObject({ borrowed: ["Eb", "Db", "Bbm", "G", "A"] });
  });

  test("minor keys: the major V and the harmonic minor's vii° are fine", () => {
    expect(checkChartChords({ key: "Am", sections: [section("verse", "Am Dm E Am", "F G C E7", "Am G#dim Am")] }).chords).toEqual([]);
  });
});
