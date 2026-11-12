import type { BeatLevel } from "../metronome/index.js";
import type { MetronomeLightUpValue } from "../constants/index.js";
import { barAt, type ChartBar } from "./bars.js";
import type { RenderedChart } from "./render.js";
import { structureOf, type StructureGroup } from "./structure.js";

/**
 * What the Drums view (issue #107) and the metronome's displays (issue #443)
 * show: the song's sections with their bars, the beat of the bar the music
 * is on, and the words around it. Worked out from the chart and its bars,
 * the same on every device.
 */

export interface DrumsSection {
  passId: string;
  passIndex: number;
  type: string;
  number: number | null;
  group: StructureGroup;
  /** Its bars; 0 when the chart doesn't say (no time signature, nothing to count). */
  bars: number;
  /** Its first words, to know where the singers come in; null for a section without any. */
  firstWords: string | null;
  /** What's written for the band on it: the pass's note, then its lines'. */
  notes: string[];
}

/** The song's passes in the order they're played, each with its bars, first words and notes. */
export function drumsSections(chart: Pick<RenderedChart, "passes">, bars: readonly Pick<ChartBar, "passIndex">[]): DrumsSection[] {
  const counts = new Map<number, number>();
  for (const bar of bars) counts.set(bar.passIndex, (counts.get(bar.passIndex) ?? 0) + 1);
  const steps = structureOf(chart as RenderedChart);
  return chart.passes.map((pass, passIndex) => {
    const step = steps[passIndex]!;
    const sung = pass.lines.find((line) => line.text.trim());
    const notes = [pass.note, ...pass.lines.map((line) => line.note)].filter((note): note is string => !!note?.trim()).map((note) => note.trim());
    return {
      passId: pass.id,
      passIndex,
      type: step.type,
      number: step.number,
      group: step.group,
      bars: counts.get(passIndex) ?? 0,
      firstWords: sung ? sung.text.trim() : null,
      notes,
    };
  });
}

export interface DrumsBeat {
  /** The bar it's in (0-based through the song); null in the count-in. */
  bar: number | null;
  /** Its pass; null in the count-in. */
  passIndex: number | null;
  /** 1-based bar of its pass, and how many it has. */
  barInPass: number;
  barsInPass: number;
  /** 0-based beat of the bar, and how many the bar has. */
  beat: number;
  beats: number;
  countIn: boolean;
}

/**
 * The beat at `position` (in beats from the song's start, negative in the
 * count-in, as the bars' clock gives it): its bar, its pass and its place in
 * the bar. In the count-in, the first bar's beats count down to it. Null
 * past the end, or for a song without bars.
 */
export function drumsBeatAt(bars: readonly ChartBar[], position: number): DrumsBeat | null {
  if (bars.length === 0 || !Number.isFinite(position)) return null;
  if (position < 0) {
    const beats = bars[0]!.beats;
    const beat = ((Math.floor(position) % beats) + beats) % beats;
    return { bar: null, passIndex: null, barInPass: 0, barsInPass: bars[0]!.barsInPass, beat, beats, countIn: true };
  }
  const at = barAt(bars, position);
  if (!at) return null;
  const bar = bars[at.bar]!;
  return { bar: bar.index, passIndex: bar.passIndex, barInPass: bar.barInPass + 1, barsInPass: bar.barsInPass, beat: Math.min(at.beat, bar.beats - 1), beats: bar.beats, countIn: false };
}

/** Whether a beat of this level lights up, for "Light up" (issue #443): every beat, the accents only, or the accents and the medium beats. */
export function beatLightsUp(level: BeatLevel | undefined, lightUp: MetronomeLightUpValue): boolean {
  if (lightUp === "every") return true;
  if (lightUp === "accents") return level === "accent";
  return level === "accent" || level === "medium";
}

export interface DrumsWords {
  /** The line being sung (or about to be, in a bar before its words), and the one after it; null when there's none. */
  now: string | null;
  next: string | null;
}

/**
 * The words around a bar, for the Drums view: the line its pass is on there
 * (the last one started, else the pass's first), and the line after it -
 * the next pass's first words at the end of a pass.
 */
export function drumsWordsAt(chart: Pick<RenderedChart, "passes">, bars: readonly Pick<ChartBar, "passIndex" | "lineId">[], barIndex: number | null, passIndex: number): DrumsWords {
  const pass = chart.passes[passIndex];
  if (!pass) return { now: null, next: null };
  const sung = pass.lines.filter((line) => line.text.trim());
  let at = 0;
  if (barIndex !== null) {
    // The last line of this pass that a bar so far has been under.
    for (let i = barIndex; i >= 0 && bars[i]?.passIndex === passIndex; i--) {
      const found = sung.findIndex((line) => line.id === bars[i]!.lineId);
      if (found >= 0) {
        at = found;
        break;
      }
    }
  }
  const now = sung[at]?.text.trim() ?? null;
  let next = sung[at + 1]?.text.trim() ?? null;
  for (let i = passIndex + 1; next === null && i < chart.passes.length; i++) {
    next = chart.passes[i]!.lines.find((line) => line.text.trim())?.text.trim() ?? null;
  }
  return { now, next };
}
