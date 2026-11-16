import type { RenderedChart, RenderedChord } from "../song-document/render.js";
import { barAt, lineAtPosition, type BeatPlace, type ChartBar } from "../song-document/bars.js";
import type { PassageChapter } from "../scriptures/references.js";
import { formatChord, nashvilleChord, simplifyChord } from "../chords/chord.js";
import { readPassageLayout, type PassageLayout } from "./parts.js";

/**
 * Screens (issue #186): a set's lyrics on a big screen, or its chart for the
 * band, led from Live. The leader and every screen work out the same slides
 * from the same chart, so only "this song, slide N" crosses the network.
 */

export const SCREEN_MODES = ["LYRICS", "CHART"] as const;
export type ScreenMode = (typeof SCREEN_MODES)[number];

/** How long a pairing lasts (issue #284): a guest's laptop for a service, a rented venue for a week, or until it's disconnected. */
export const SCREEN_PAIRING_LENGTHS = ["12h", "1d", "1w", "unlimited"] as const;
export type ScreenPairingLength = (typeof SCREEN_PAIRING_LENGTHS)[number];
/** How long a screen is borrowed for a set (issue #480): it shows what it showed before afterwards. */
export const SCREEN_BORROW_HOURS = [1, 3, 6, 12] as const;
export type ScreenBorrowHours = (typeof SCREEN_BORROW_HOURS)[number];
const PAIRING_LENGTH_MS: Record<ScreenPairingLength, number | null> = { "12h": 12 * 3600_000, "1d": 24 * 3600_000, "1w": 7 * 24 * 3600_000, unlimited: null };

/** When a pairing made (or extended) at `now` for `lasts` ends; null: it doesn't. */
export function screenPairingEnds(lasts: ScreenPairingLength, now: Date = new Date()): Date | null {
  const length = PAIRING_LENGTH_MS[lasts];
  return length === null ? null : new Date(now.getTime() + length);
}

/** Lines of lyrics on a slide, unless asked otherwise. */
export const LYRIC_LINES_PER_SLIDE = 2;

export interface ScreenSlide {
  /** The pass (of the flow, or of the arrangement) it's from, by index and ID. */
  passIndex: number;
  passId: string;
  /** The pass's label: its own ("Final chorus"), else its section's; null when it has none. */
  label: string | null;
  /** The lyrics shown: none for a pass without words (an instrumental). */
  lines: string[];
  /** Its place among its pass's slides, from 0. */
  part: number;
  /** A passage's verse numbers in its lines (issue #485), by line and characters: a screen draws them in the template's look. */
  numbers?: { line: number; from: number; to: number }[];
}

/**
 * A chart as slides of lyrics: each pass's sung lines - not its notes, nor a
 * line of chords alone - `size` at a time, in order. A pass without any
 * words is one empty slide, so stepping through the song passes it as the
 * band plays it.
 */
export function lyricSlides(chart: Pick<RenderedChart, "passes">, size: number = LYRIC_LINES_PER_SLIDE): ScreenSlide[] {
  const per = Math.max(1, Math.floor(size));
  const slides: ScreenSlide[] = [];
  chart.passes.forEach((pass, passIndex) => {
    const label = pass.label ?? pass.section.label ?? null;
    const lines = pass.lines.filter((line) => line.kind === "lyric").map((line) => line.text.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (lines.length === 0) {
      slides.push({ passIndex, passId: pass.id, label, lines: [], part: 0 });
      return;
    }
    for (let at = 0, part = 0; at < lines.length; at += per, part++) slides.push({ passIndex, passId: pass.id, label, lines: lines.slice(at, at + per), part });
  });
  return slides;
}

/** A line of a slide with its chords (issue #395): its words as `lyricSlides` shows them, and where each chord falls in them. */
export interface ScreenSlideLine {
  /** The chart's line. */
  lineId: string;
  text: string;
  /** Each chord at a character of `text` (the words' spaces evened out as the slide shows them). */
  chords: { at: number; chord: RenderedChord }[];
}

/**
 * A chord as a lyrics screen names it (issue #395): as it sounds (a screen
 * is for the singers and the room, never the capo's shapes), simpler when
 * asked (the triad, no bass note), in letters, Nashville numbers counted
 * from the key it's sung in there, or solfège.
 */
export function screenChordLabel(
  chord: { sounding: string; key: string | null },
  options: { notation: "letters" | "numbers" | "solfege"; simple: boolean },
): string {
  const raw = options.simple ? simplifyChord(chord.sounding, { dropExtensions: true, dropBass: true }) : chord.sounding;
  if (options.notation === "numbers") return nashvilleChord(raw, chord.key);
  if (options.notation === "solfege") return formatChord(raw, "solfege");
  return raw;
}

/**
 * Every slide's lines with their chords (issue #395), cut as `lyricSlides`
 * cuts them, for a lyrics screen that shows chords over its words, and the
 * kind of section each slide is from (`sectionType`).
 */
export function lyricSlideLines(chart: Pick<RenderedChart, "passes">, size: number = LYRIC_LINES_PER_SLIDE): { sectionType: string; lines: ScreenSlideLine[] }[] {
  const per = Math.max(1, Math.floor(size));
  const slides: { sectionType: string; lines: ScreenSlideLine[] }[] = [];
  chart.passes.forEach((pass) => {
    const lines = pass.lines
      .filter((line) => line.kind === "lyric")
      .map((line) => evenScreenLine(line.id, line.text, line.chords))
      .filter((line) => line.text !== "");
    if (lines.length === 0) {
      slides.push({ sectionType: pass.section.type, lines: [] });
      return;
    }
    for (let at = 0; at < lines.length; at += per) slides.push({ sectionType: pass.section.type, lines: lines.slice(at, at + per) });
  });
  return slides;
}

/** A line's words with runs of spaces made one and the ends trimmed, as a slide shows them, its chords moved with them. */
export function evenScreenLine(lineId: string, raw: string, chords: RenderedChord[]): ScreenSlideLine {
  // Where each character of the raw line lands in the evened one.
  const map: number[] = [];
  let text = "";
  let space = false;
  for (const ch of raw) {
    map.push(text.length);
    if (/\s/.test(ch)) {
      space = true;
      continue;
    }
    if (space && text !== "") text += " ";
    space = false;
    text += ch;
  }
  map.push(text.length);
  // A trimmed start moves everything; a chord past the end sits on the last character.
  return {
    lineId,
    text,
    chords: chords.map((chord) => ({ at: Math.max(0, Math.min(map[Math.min(chord.at, raw.length)] ?? text.length, Math.max(0, text.length - 1))), chord })),
  };
}

/**
 * How far the words are sung at `position` (in beats from the song's
 * start), for a screen filling them in as they're sung (issue #395): the
 * line (`lineAtPosition`) and the place in its text, as a lyrics screen
 * shows it (spaces evened out), moving from the letter placed on the beat
 * before to the next one placed after it in the line (or the line's end)
 * through the beats between. Null when no line is being sung.
 */
export function sungAtPosition(
  chart: Pick<RenderedChart, "passes">,
  bars: readonly ChartBar[],
  places: readonly (BeatPlace | null)[][],
  position: number,
): { passIndex: number; lineId: string; at: number } | null {
  const now = barAt(bars, position);
  const line = now ? lineAtPosition(bars, places, position) : null;
  if (!now || !line) return null;
  const text = chart.passes[line.passIndex]?.lines.find((one) => one.id === line.lineId)?.text;
  if (text === undefined) return null;
  // The beat placed at or before it in the line, and the next placed after it.
  let from: { beat: number; at: number } | null = null;
  for (let bar = now.bar; bar >= 0 && !from && bars[bar]!.passIndex === line.passIndex; bar--) {
    const beats = places[bar] ?? [];
    for (let beat = bar === now.bar ? Math.min(now.beat, beats.length - 1) : beats.length - 1; beat >= 0; beat--) {
      const place = beats[beat];
      if (place && place.lineId === line.lineId) {
        from = { beat: bars[bar]!.start + beat, at: place.at };
        break;
      }
    }
  }
  if (!from) return null;
  let to: { beat: number; at: number } = { beat: from.beat + 1, at: text.length };
  search: for (let bar = now.bar; bar < bars.length && bars[bar]!.passIndex === line.passIndex; bar++) {
    const beats = places[bar] ?? [];
    for (let beat = bar === now.bar ? now.beat + 1 : 0; beat < beats.length; beat++) {
      const place = beats[beat];
      const start = bars[bar]!.start + beat;
      if (!place) continue;
      if (place.lineId === line.lineId && place.at > from.at) to = { beat: start, at: place.at };
      else to = { beat: start, at: text.length };
      break search;
    }
  }
  const through = Math.max(0, Math.min(1, (position - from.beat) / Math.max(1e-6, to.beat - from.beat)));
  const raw = from.at + through * (to.at - from.at);
  return { passIndex: line.passIndex, lineId: line.lineId, at: Math.round(evenAt(text, raw) * 100) / 100 };
}

/** A place (fractional) in a line's text as a lyrics screen shows it: spaces evened out, the start trimmed. */
function evenAt(raw: string, at: number): number {
  let even = 0;
  let space = false;
  for (let index = 0; index < raw.length; index++) {
    const ch = raw[index]!;
    if (/\s/.test(ch)) {
      space = true;
      continue;
    }
    if (space && even > 0) even += 1;
    space = false;
    if (at < index + 1) return even + Math.max(0, at - index);
    even += 1;
  }
  return even;
}

/**
 * The slide showing the words sung at `position` (in beats from the song's
 * start; a beat or two ahead, so they're read before they're sung), as
 * `lyricSlides` cuts the chart: the slide of the line `lineAtPosition`
 * finds, else its pass's first one (an intro, an instrumental). What
 * "Follow the music" shows (issue #238). Null outside the song.
 */
export function slideAtPosition(
  chart: Pick<RenderedChart, "passes">,
  bars: readonly ChartBar[],
  places: readonly (BeatPlace | null)[][],
  position: number,
  size: number = LYRIC_LINES_PER_SLIDE,
): number | null {
  const slides = lyricSlides(chart, size);
  const now = barAt(bars, position);
  const bar = now ? bars[now.bar] : undefined;
  if (!bar) return null;
  const first = slides.findIndex((slide) => slide.passIndex === bar.passIndex);
  if (first < 0) return null;
  const line = lineAtPosition(bars, places, position);
  if (!line) return first;
  const per = Math.max(1, Math.floor(size));
  const sung = chart.passes[line.passIndex]!.lines.filter((one) => one.kind === "lyric" && one.text.trim() !== "");
  const index = sung.findIndex((one) => one.id === line.lineId);
  // A line not on the slides (a line of chords alone): its pass's first.
  return index < 0 ? first : first + Math.floor(index / per);
}

/**
 * A text item's slides (issue #305): its body's paragraphs, split by a blank
 * line, each one slide of its lines as written - none dropped, none joined -
 * with the item's title as their label. An empty body is one empty slide,
 * like a pass without words.
 */
export function textSlides(text: { title: string; body: string }): ScreenSlide[] {
  const label = text.title.trim() || null;
  const paragraphs = text.body
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean))
    .filter((lines) => lines.length > 0);
  if (paragraphs.length === 0) return [{ passIndex: 0, passId: "text-0", label, lines: [], part: 0 }];
  return paragraphs.map((lines, index) => ({ passIndex: index, passId: `text-${index}`, label, lines, part: 0 }));
}

/**
 * A passage item as the API gives it (issue #301): its imported Bible and
 * reference, and the verses read from that Bible - none when the Bible is
 * gone, or for a use its licence doesn't allow (an offline copy). Its
 * copyright line goes with its text wherever it's shown.
 */
export interface SetItemPassage {
  /** An imported Bible's id; "" for a YouVersion version's passage. */
  bibleId: string;
  /** A YouVersion version's number (issue #310): its text read from YouVersion each time, never kept. Left out for an imported Bible. */
  youversionId?: number;
  /** YouVersion's page for the version, shown with its passages. */
  link?: string | null;
  /** As people write it, with the Bible's own name for the book: "John 3:16-18". */
  reference: string;
  /** The book's name in that Bible, for each verse's label. */
  bookName: string;
  /** Null when the Bible was deleted. */
  bible: { name: string; abbreviation: string | null; copyright: string | null } | null;
  chapters: PassageChapter[];
  /** Whether its Bible may be shown on screens (the admin's say, for its licence): without it, it has no slides. */
  projection: boolean;
  /** The template the screens show it with (issue #310), with how many verses it puts on a slide; null or left out: the screen's own, a verse a slide. */
  template?: SetItemTemplate | null;
  /**
   * On a screen, how many seconds from now its verses may be kept on the
   * device (issue #485): a YouVersion passage's, as its Cache-Control allows
   * a private cache - 0 when it doesn't or an admin turned keeping off. Left
   * out: as the set's other items (an imported Bible's).
   */
  keepSeconds?: number;
  /** The screen's own note of when it must let go of a YouVersion passage's verses (ms, its own clock), from `keepSeconds` when they came. */
  keepUntil?: number;
  /** Its verses left out because the screen said it already has them (issue #485): it keeps showing its own. */
  held?: boolean;
}

/** How a screen names a passage whose verses it has (issue #485), to not be sent them again: its YouVersion version and reference. */
export function passageHeldKey(passage: Pick<SetItemPassage, "youversionId" | "reference">): string | null {
  return passage.youversionId === undefined ? null : `${passage.youversionId}:${passage.reference}`;
}

/** A set item's own screen template (issue #310): a saved one by its id and name, or a built-in one by its id (named in `screens.templates`). */
export interface SetItemTemplate {
  id: string | null;
  builtIn: string | null;
  name: string | null;
  versesPerSlide: number;
  /** How it cuts the passage beyond that (issue #485); left out (an older API): the defaults. */
  passages?: PassageLayout;
}

/** Characters on a line of a passage's slide, at most (a longer word keeps its own line), unless its template says otherwise. */
export const PASSAGE_LINE_CHARS = 44;
/** Lines of a passage on a slide, at most: a longer verse goes on over several. */
export const PASSAGE_LINES_PER_SLIDE = 4;
/** Lines on a slide of several verses, at most, however many its template puts together. */
export const PASSAGE_LINES_MAX = 10;
/** Lines on a slide filled with whole verses (issue #485), unless its template says otherwise. */
export const PASSAGE_FILL_LINES = 6;

/** A piece of a passage's text kept on one line: a word, or a verse's number with the word after it. */
interface Unit {
  text: string;
  /** Where its number is, in its text. */
  number?: { from: number; to: number };
}

/** Units put on lines of at most `width` characters, in order, the numbers' places kept; a longer unit is a line of its own. */
interface WrappedLine {
  text: string;
  numbers: { from: number; to: number }[];
}

function wrapUnits(units: Unit[], width: number): WrappedLine[] {
  const lines: WrappedLine[] = [];
  let line: WrappedLine | null = null;
  for (const unit of units) {
    if (line && line.text.length + 1 + unit.text.length > width) {
      lines.push(line);
      line = null;
    }
    const at: number = line ? line.text.length + 1 : 0;
    line = line ? { text: `${line.text} ${unit.text}`, numbers: line.numbers } : { text: unit.text, numbers: [] };
    if (unit.number) line.numbers.push({ from: at + unit.number.from, to: at + unit.number.to });
  }
  if (line) lines.push(line);
  return lines;
}

/** A verse's units: its number glued to its first word (a number never ends a line), then its words. */
function verseUnits(verse: { number: number; endNumber?: number; text: string }, numbered: boolean): Unit[] {
  const words = verse.text.split(/\s+/).filter(Boolean);
  if (!numbered) return words.map((text) => ({ text }));
  const number = verse.endNumber !== undefined && verse.endNumber > verse.number ? `${verse.number}-${verse.endNumber}` : `${verse.number}`;
  const [first, ...rest] = words;
  return [{ text: first ? `${number} ${first}` : number, number: { from: 0, to: number.length } }, ...rest.map((text) => ({ text }))];
}

/**
 * Lines cut into slides of at most `size` lines; with `sentences`, the units
 * cut at sentences' ends first, as many whole sentences on a slide as fit, a
 * sentence too long for one going on line by line.
 */
function cutSlides(units: Unit[], wrap: (units: Unit[]) => WrappedLine[], size: number, sentences: boolean): WrappedLine[][] {
  const bySize = (lines: WrappedLine[]) => Array.from({ length: Math.ceil(lines.length / size) }, (_, i) => lines.slice(i * size, (i + 1) * size));
  const all = wrap(units);
  if (!sentences || all.length <= size) return bySize(all);
  const pieces: Unit[][] = [[]];
  for (const unit of units) {
    pieces[pieces.length - 1]!.push(unit);
    if (/[.!?;:][\u201d\u2019"'\u00bb)\]]*$/.test(unit.text)) pieces.push([]);
  }
  const slides: WrappedLine[][] = [];
  let taken: Unit[] = [];
  for (const piece of pieces.filter((one) => one.length > 0)) {
    if (taken.length > 0 && wrap([...taken, ...piece]).length <= size) {
      taken.push(...piece);
      continue;
    }
    if (taken.length > 0) slides.push(wrap(taken));
    taken = [];
    const lines = wrap(piece);
    if (lines.length <= size) taken = [...piece];
    else slides.push(...bySize(lines));
  }
  if (taken.length > 0) slides.push(wrap(taken));
  return slides;
}

/**
 * A passage's slides (issues #301, #310, #485), cut as its template says:
 * its verses `versesPerSlide` together (one by default), or as many whole
 * verses as fill a slide - never across chapters - their words on lines of
 * at most `lineLength` characters (each verse on its own lines if asked),
 * `lines` a slide at most (by default 4 for one verse, more for several up
 * to 10; 6 filling), a verse too long going on over several - at a
 * sentence's end if asked - labelled with their place ("John 3:16", "John
 * 3:16-17"). Verse numbers start their verses as the template says (with
 * several verses on a slide by default), marked for the screens' look. None
 * when its Bible may not be shown on screens, or has no verses for it.
 */
export function passageSlides(passage: Pick<SetItemPassage, "bookName" | "chapters" | "projection" | "template">): ScreenSlide[] {
  if (!passage.projection) return [];
  const layout = passage.template?.passages ?? readPassageLayout(undefined);
  const fill = layout.split === "fill";
  const together = Math.max(1, Math.floor(passage.template?.versesPerSlide ?? 1));
  const perSlide = layout.lines ?? (fill ? PASSAGE_FILL_LINES : Math.min(PASSAGE_LINES_PER_SLIDE * together, PASSAGE_LINES_MAX));
  const unitsOf = (verses: PassageChapter["verses"]) => {
    const numbered = layout.numbers === "always" || (layout.numbers === "several" && verses.length > 1);
    // Each verse on its own lines: a break before each verse's first unit.
    return verses.flatMap((verse) => verseUnits(verse, numbered).map((unit, index) => (layout.verseLines && index === 0 ? { ...unit, newLine: true } : unit)));
  };
  const wrap = (units: (Unit & { newLine?: boolean })[]) => {
    if (!layout.verseLines) return wrapUnits(units, layout.lineLength);
    const runs: Unit[][] = [];
    for (const unit of units) (unit.newLine || runs.length === 0 ? runs[runs.push([]) - 1]! : runs[runs.length - 1]!).push(unit);
    return runs.flatMap((run) => wrapUnits(run, layout.lineLength));
  };
  const linesOf = (verses: PassageChapter["verses"]) => wrap(unitsOf(verses));
  const slides: ScreenSlide[] = [];
  let passIndex = 0;
  for (const chapter of passage.chapters) {
    // The verses each slide (or run of slides, for a long verse) holds.
    const groups: PassageChapter["verses"][] = [];
    if (!fill) for (let at = 0; at < chapter.verses.length; at += together) groups.push(chapter.verses.slice(at, at + together));
    else {
      for (const verse of chapter.verses) {
        const last = groups[groups.length - 1];
        if (last && linesOf([...last, verse]).length <= perSlide) last.push(verse);
        else groups.push([verse]);
      }
    }
    for (const verses of groups) {
      const first = verses[0]!;
      const last = verses[verses.length - 1]!;
      const end = Math.max(last.endNumber ?? last.number, last.number);
      const number = end > first.number ? `${first.number}-${end}` : `${first.number}`;
      const label = `${passage.bookName} ${chapter.chapter}:${number}`;
      const passId = `verse-${chapter.chapter}-${first.number}`;
      cutSlides(unitsOf(verses), wrap, perSlide, layout.sentences).forEach((shown, part) => {
        const numbers = shown.flatMap((one, index) => one.numbers.map((mark) => ({ line: index, ...mark })));
        slides.push({ passIndex, passId, label, lines: shown.map((one) => one.text), part, ...(numbers.length > 0 && { numbers }) });
      });
      passIndex++;
    }
  }
  return slides;
}

/**
 * A set item's slides, whatever it is (issue #305) - the one rule every
 * client cuts an item by, so only "this item, slide N" crosses the network:
 * a song's chart by lyricSlides, a text by textSlides, a passage by
 * passageSlides; anything else (a song the viewer can't read, a kind this
 * client doesn't know) has none.
 */
export function setItemSlides(
  item: { chart?: Pick<RenderedChart, "passes"> | null; text?: { title: string; body: string } | null; passage?: Pick<SetItemPassage, "bookName" | "chapters" | "projection" | "template"> | null },
  size: number = LYRIC_LINES_PER_SLIDE,
): ScreenSlide[] {
  if (item.chart) return lyricSlides(item.chart, size);
  if (item.text) return textSlides(item.text);
  if (item.passage) return passageSlides(item.passage);
  return [];
}

/**
 * What an item's slides say, in a few characters (issue #247): the same on
 * every client that cut the same words the same way. Sent with "this item,
 * slide N", so a screen whose own slides differ (the song edited since it
 * loaded it) knows slide N isn't the words meant. Only the words count: a
 * label or a chord changed doesn't change what's read.
 */
export function slideKey(slides: Pick<ScreenSlide, "lines">[]): string {
  // FNV-1a, 32 bits: no crypto needed, the same in every language.
  let hash = 0x811c9dc5;
  const text = slides.map((slide) => slide.lines.join("\n")).join("\f");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${slides.length.toString(36)}-${hash.toString(36)}`;
}

/**
 * The slide `slide` moves to, going `by` slides on, kept within the song;
 * null when it would leave it (the leader goes to the next or previous song).
 */
export function stepSlide(count: number, slide: number, by: number): number | null {
  const next = slide + by;
  return next < 0 || next >= count ? null : next;
}

/** A screen's pairing code: letters and digits nobody mixes up (no 0/O, 1/I/L). */
export const SCREEN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const SCREEN_CODE_LENGTH = 6;

/** A code as typed - spaces, dashes, lower case - as it's kept ("K7QM3X"); null when it can't be one. */
export function normalizeScreenCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== SCREEN_CODE_LENGTH) return null;
  return [...code].every((char) => SCREEN_CODE_ALPHABET.includes(char)) ? code : null;
}

/** A code as it's shown, in two halves: "K7Q-M3X". */
export function formatScreenCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
export * from "./theme.js";
export * from "./parts.js";
export * from "./isf.js";
export * from "./shader-spec.js";
export * from "./shaders.js";
export * from "./reports.js";

export * from "./timers.js";
export * from "./day-set.js";
export * from "./widgets.js";
export * from "./step.js";
