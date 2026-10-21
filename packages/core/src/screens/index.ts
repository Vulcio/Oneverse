import type { RenderedChart } from "../song-document/render.js";
import type { PassageChapter } from "../scriptures/references.js";

/**
 * Screens (issue #186): a set's lyrics on a big screen, or its chart for the
 * band, led from Live. The leader and every screen work out the same slides
 * from the same chart, so only "this song, slide N" crosses the network.
 */

export const SCREEN_MODES = ["LYRICS", "CHART"] as const;
export type ScreenMode = (typeof SCREEN_MODES)[number];

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
  bibleId: string;
  /** As people write it, with the Bible's own name for the book: "John 3:16-18". */
  reference: string;
  /** The book's name in that Bible, for each verse's label. */
  bookName: string;
  /** Null when the Bible was deleted. */
  bible: { name: string; abbreviation: string | null; copyright: string | null } | null;
  chapters: PassageChapter[];
  /** Whether its Bible may be shown on screens (the admin's say, for its licence): without it, it has no slides. */
  projection: boolean;
}

/** Characters on a line of a passage's slide, at most (a longer word keeps its own line). */
export const PASSAGE_LINE_CHARS = 44;
/** Lines of a passage on a slide, at most: a longer verse goes on over several. */
export const PASSAGE_LINES_PER_SLIDE = 4;

/** Words put on lines of at most `width` characters, in order; a longer word is a line of its own. */
function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * A passage's slides (issue #301): each verse on slides of its own, its words
 * on lines of at most PASSAGE_LINE_CHARS, PASSAGE_LINES_PER_SLIDE lines a
 * slide, labelled with its place ("John 3:16", "John 3:16-17" for verses
 * printed together). None when its Bible may not be shown on screens, or
 * has no verses for it.
 */
export function passageSlides(passage: Pick<SetItemPassage, "bookName" | "chapters" | "projection">): ScreenSlide[] {
  if (!passage.projection) return [];
  const slides: ScreenSlide[] = [];
  let passIndex = 0;
  for (const chapter of passage.chapters) {
    for (const verse of chapter.verses) {
      const number = verse.endNumber !== undefined && verse.endNumber > verse.number ? `${verse.number}-${verse.endNumber}` : `${verse.number}`;
      const label = `${passage.bookName} ${chapter.chapter}:${number}`;
      const passId = `verse-${chapter.chapter}-${verse.number}`;
      const lines = wrapWords(verse.text, PASSAGE_LINE_CHARS);
      for (let at = 0, part = 0; at < lines.length; at += PASSAGE_LINES_PER_SLIDE, part++) {
        slides.push({ passIndex, passId, label, lines: lines.slice(at, at + PASSAGE_LINES_PER_SLIDE), part });
      }
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
  item: { chart?: Pick<RenderedChart, "passes"> | null; text?: { title: string; body: string } | null; passage?: Pick<SetItemPassage, "bookName" | "chapters" | "projection"> | null },
  size: number = LYRIC_LINES_PER_SLIDE,
): ScreenSlide[] {
  if (item.chart) return lyricSlides(item.chart, size);
  if (item.text) return textSlides(item.text);
  if (item.passage) return passageSlides(item.passage);
  return [];
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
export * from "./shaders.js";
export * from "./reports.js";

export * from "./timers.js";
export * from "./day-set.js";
export * from "./widgets.js";
