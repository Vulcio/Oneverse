import { describe, expect, it } from "vite-plus/test";
import { beatAt, beatsFromGrouping, beatsPerMinute, beatsPerTempoUnit, changeMetronome, clicksBetween, DEFAULT_METRONOME, defaultBeats, defaultTempoUnit, secondsPerBeat, metronomeForSong, normalizeMetronome, tapTempo, type MetronomeSettings } from "../metronome/index.js";

const settings = (change: Partial<MetronomeSettings> = {}) => normalizeMetronome({ ...DEFAULT_METRONOME, ...change });

describe("the metronome's timeline (issue #2)", () => {
  it("a bar of 4/4: the bell, then three clicks, on channel 10", () => {
    const clicks = clicksBetween(settings(), 0, 4);
    expect(clicks.map((c) => [c.position, c.beat, c.level, c.note, c.channel])).toEqual([
      [0, 0, "accent", 34, 10],
      [1, 1, "normal", 33, 10],
      [2, 2, "normal", 33, 10],
      [3, 3, "normal", 33, 10],
    ]);
    expect(clicksBetween(settings(), 4, 5)[0]).toMatchObject({ bar: 1, beat: 0, tick: 1920 });
  });

  it("a beat of 6/8 is an eighth: 240 ticks", () => {
    const clicks = clicksBetween(settings({ numerator: 6, denominator: 8, tempoUnit: "1/8" }), 0, 7);
    expect(clicks.map((c) => c.tick)).toEqual([0, 240, 480, 720, 960, 1200, 1440]);
    expect(clicks.at(-1)).toMatchObject({ bar: 1, beat: 0, level: "accent" });
  });

  it("6/8 counts quarters unless the song says (issue #384): at 71, twice as fast as 3/4 in a bar as long, 4 medium", () => {
    const six = settings({ tempo: 71, numerator: 6, denominator: 8 });
    const three = settings({ tempo: 71, numerator: 3, denominator: 4 });
    expect(six.tempoUnit).toBe("1/4");
    expect(beatsPerMinute(six)).toBe(142);
    expect(secondsPerBeat(six) * 6).toBeCloseTo(secondsPerBeat(three) * 3, 9);
    expect(clicksBetween(six, 0, 6).map((c) => `${c.position}:${c.level}`)).toEqual(["0:accent", "1:normal", "2:normal", "3:medium", "4:normal", "5:normal"]);
    expect(clicksBetween(three, 0, 3).map((c) => c.level)).toEqual(["accent", "normal", "normal"]);
    expect(beatsPerMinute(settings({ tempo: 71, numerator: 6, denominator: 8, tempoUnit: "1/8" }))).toBe(71);
    expect(beatsPerMinute(settings({ tempo: 71, numerator: 6, denominator: 8, tempoUnit: "1/4." }))).toBe(213);
    expect(settings({ numerator: 3, denominator: 8 }).tempoUnit).toBe("1/8");
    expect(settings({ numerator: 12, denominator: 8 }).tempoUnit).toBe("1/4");
    expect(settings({ numerator: 2, denominator: 2 }).tempoUnit).toBe("1/2");
  });

  it("whatever note the tempo counts, every beat clicks: the note only sets the speed", () => {
    for (const tempoUnit of ["1/8", "1/4", "1/8.", "1/2", "1/2."] as const) expect(clicksBetween(settings({ numerator: 6, denominator: 8, tempoUnit }), 0, 6).map((c) => c.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(clicksBetween(settings({ tempoUnit: "1/2" }), 0, 4).map((c) => c.position)).toEqual([0, 1, 2, 3]);
    expect(secondsPerBeat(settings({ tempo: 60, tempoUnit: "1/2" }))).toBe(0.5);
    expect(secondsPerBeat(settings({ tempo: 60, tempoUnit: "1/8" }))).toBe(2);
    expect(beatsPerTempoUnit("1/8.", 16)).toBe(3);
    expect(defaultTempoUnit({ numerator: 6, denominator: 16 })).toBe("1/8");
  });

  it("a song's tempo note comes with it, else its time signature's", () => {
    const mine = settings({ tempoUnit: "1/8" });
    expect(metronomeForSong(mine, { tempo: 71, timeSignature: { numerator: 6, denominator: 8 } }).tempoUnit).toBe("1/4");
    expect(metronomeForSong(mine, { tempo: 71, tempoUnit: "1/8", timeSignature: { numerator: 6, denominator: 8 } }).tempoUnit).toBe("1/8");
    expect(metronomeForSong(mine, { tempo: null }).tempoUnit).toBe("1/8");
  });

  it("the pattern: muted beats are silent, subdivisions with them", () => {
    const clicks = clicksBetween(settings({ beats: ["accent", "mute", "normal", "accent"], subdivision: 2 }), 0, 4);
    expect(clicks.map((c) => `${c.position}:${c.level}`)).toEqual(["0:accent", "0.5:sub", "2:normal", "2.5:sub", "3:accent", "3.5:sub"]);
  });

  it("triplets land on thirds, without drifting", () => {
    const clicks = clicksBetween(settings({ subdivision: 3 }), 10000, 10001);
    expect(clicks.map((c) => c.sub)).toEqual([0, 1, 2]);
    expect(clicks[1]!.position).toBeCloseTo(10000 + 1 / 3, 9);
    // A window starting between two clicks begins at the next one.
    expect(clicksBetween(settings({ subdivision: 3 }), 0.2, 1).map((c) => c.sub)).toEqual([1, 2]);
  });

  it("a count-in: every beat, the song's bar 0 after it; count-in only goes silent", () => {
    const counted = settings({ countIn: 1, beats: ["accent", "mute", "mute", "mute"], subdivision: 2 });
    const clicks = clicksBetween(counted, 0, 5);
    expect(clicks.map((c) => `${c.bar}.${c.beat}.${c.sub}:${c.level}`)).toEqual(["-1.0.0:accent", "-1.1.0:normal", "-1.2.0:normal", "-1.3.0:normal", "0.0.0:accent", "0.0.1:sub"]);
    expect(beatAt(counted, 4.5)).toEqual({ bar: 0, beat: 0, fraction: 0.5 });
    expect(clicksBetween({ ...counted, countInOnly: true }, 0, 12)).toHaveLength(4);
  });

  it("stored settings are made valid", () => {
    expect(normalizeMetronome({ tempo: 900, numerator: 3, beats: ["accent"], denominator: 5, volume: 3 })).toMatchObject({
      tempo: 300,
      numerator: 3,
      beats: ["accent", "normal", "normal"],
      denominator: 4,
      volume: 1,
    });
    expect(normalizeMetronome(null)).toEqual({ ...DEFAULT_METRONOME, tempoUnit: "1/4" });
    expect(normalizeMetronome({ numerator: 3, beats: ["accent", "medium", "loud"] }).beats).toEqual(["accent", "normal", "normal"]);
    expect(normalizeMetronome({ countInOnly: true }).countInOnly).toBe(false);
    // A slowed recording's beat kept to the hundredth (issue #139).
    expect(normalizeMetronome({ tempo: 97 * 0.85 }).tempo).toBe(82.45);
  });

  it("a song's tempo and time signature, with the player's pattern for that time signature", () => {
    const mine = changeMetronome(settings({ sound: "wood" }), { beats: ["accent", "normal", "accent", "normal"] });
    expect(mine.patterns).toEqual({ "4/4": ["accent", "normal", "accent", "normal"] });
    // Settings kept before patterns per time signature: theirs is the one for their bar.
    expect(normalizeMetronome({ beats: ["accent", "normal", "accent", "normal"] }).patterns).toEqual({ "4/4": ["accent", "normal", "accent", "normal"] });
    expect(metronomeForSong(mine, { tempo: 72, timeSignature: { numerator: 4, denominator: 4 } })).toMatchObject({ tempo: 72, beats: ["accent", "normal", "accent", "normal"], sound: "wood" });
    expect(metronomeForSong(mine, { tempo: 60, timeSignature: { numerator: 3, denominator: 4 } })).toMatchObject({ tempo: 60, numerator: 3, beats: ["accent", "normal", "normal"] });
    expect(metronomeForSong(mine, { tempo: null }).tempo).toBe(100);
  });

  it("a song version's own pattern wins, when it fits the bar (issue #384)", () => {
    const mine = settings();
    const song = { tempo: 90, timeSignature: { numerator: 7, denominator: 8 } };
    expect(metronomeForSong(mine, song).beats).toEqual(["accent", "normal", "medium", "normal", "medium", "normal", "normal"]);
    expect(metronomeForSong(mine, { ...song, beats: beatsFromGrouping([3, 2, 2]) }).beats).toEqual(["accent", "normal", "normal", "medium", "normal", "medium", "normal"]);
    expect(metronomeForSong(mine, { ...song, beats: ["accent"] }).beats).toEqual(defaultBeats(song.timeSignature));
    // Played for a song, its pattern isn't the player's.
    expect(metronomeForSong(mine, { ...song, beats: beatsFromGrouping([3, 2, 2]) }).patterns).toEqual({});
  });

  it("the usual patterns (issue #384): the first beat accented, each other group's first medium", () => {
    const usual = (numerator: number, denominator: number) => defaultBeats({ numerator, denominator }).map((level) => ({ accent: "A", medium: "M", normal: "s", mute: "-" })[level]).join(" ");
    expect(usual(4, 4)).toBe("A s s s");
    expect(usual(3, 4)).toBe("A s s");
    expect(usual(2, 2)).toBe("A s");
    expect(usual(3, 8)).toBe("A s s");
    expect(usual(6, 4)).toBe("A s s s s s");
    expect(usual(6, 8)).toBe("A s s M s s");
    expect(usual(9, 8)).toBe("A s s M s s M s s");
    expect(usual(12, 8)).toBe("A s s M s s M s s M s s");
    expect(usual(5, 4)).toBe("A s s M s");
    expect(usual(7, 8)).toBe("A s M s M s s");
  });

  it("the player's pattern is kept per time signature: 6/8 and 6/4 are two (issue #384)", () => {
    let mine = changeMetronome(settings(), { numerator: 6, denominator: 8 });
    expect(mine.beats).toEqual(defaultBeats({ numerator: 6, denominator: 8 }));
    mine = changeMetronome(mine, { beats: ["accent", "mute", "normal", "accent", "mute", "normal"] });
    expect(mine.patterns).toEqual({ "6/8": ["accent", "mute", "normal", "accent", "mute", "normal"] });
    mine = changeMetronome(mine, { denominator: 4 });
    expect(mine.beats).toEqual(["accent", "normal", "normal", "normal", "normal", "normal"]);
    mine = changeMetronome(mine, { denominator: 8 });
    expect(mine.beats).toEqual(["accent", "mute", "normal", "accent", "mute", "normal"]);
    // Back to the usual one: nothing kept.
    expect(changeMetronome(mine, { beats: defaultBeats({ numerator: 6, denominator: 8 }) }).patterns).toEqual({});
  });

  it("a count-in plays the pattern, a muted beat small; medium clicks are the softer bell", () => {
    const counted = settings({ numerator: 6, denominator: 8, countIn: 1, beats: ["accent", "normal", "mute", "medium", "normal", "normal"] });
    expect(clicksBetween(counted, 0, 6).map((c) => c.level)).toEqual(["accent", "normal", "normal", "medium", "normal", "normal"]);
    const medium = clicksBetween(counted, 9, 10)[0]!;
    expect([medium.level, medium.note, medium.velocity]).toEqual(["medium", 34, 90]);
  });

  it("tap tempo: the average of the last taps; a long pause starts again", () => {
    expect(tapTempo([0])).toBeNull();
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    expect(tapTempo([0, 500, 5000, 5750])).toBe(80);
  });
});

describe("Sync play's clock (issue #13)", () => {
  it("the offset from the quickest round trip", async () => {
    const { clockOffset } = await import("../sync/index.js");
    // Server 1000 ms ahead; the second ping was held up on its way back.
    expect(clockOffset([
      { sent: 0, at: 1010, received: 20 },
      { sent: 100, at: 1105, received: 190 },
      { sent: 200, at: 1204, received: 208 },
    ])).toEqual({ offset: 1000, rtt: 8 });
    expect(clockOffset([])).toBeNull();
  });
});
