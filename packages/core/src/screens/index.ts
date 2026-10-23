import type { RenderedChart } from "../song-document/render.js";
import type { PassageChapter } from "../scriptures/references.js";

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
}

/** A set item's own screen template (issue #310): a saved one by its id and name, or a built-in one by its id (named in `screens.templates`). */
export interface SetItemTemplate {
  id: string | null;
  builtIn: string | null;
  name: string | null;
  versesPerSlide: number;
}

/** Characters on a line of a passage's slide, at most (a longer word keeps its own line). */
export const PASSAGE_LINE_CHARS = 44;
/** Lines of a passage on a slide, at most: a longer verse goes on over several. */
export const PASSAGE_LINES_PER_SLIDE = 4;
/** Lines on a slide of several verses, at most, however many its template puts together. */
export const PASSAGE_LINES_MAX = 10;

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
 * A passage's slides (issues #301, #310): its verses, as many together as its
 * template puts on a slide (one by default, never across chapters), their
 * words on lines of at most PASSAGE_LINE_CHARS - PASSAGE_LINES_PER_SLIDE
 * lines a slide for one verse, more for several, up to PASSAGE_LINES_MAX -
 * labelled with their place ("John 3:16", "John 3:16-17" for verses printed
 * or shown together). Several verses on a slide each start with their
 * number. None when its Bible may not be shown on screens, or has no verses
 * for it.
 */
export function passageSlides(passage: Pick<SetItemPassage, "bookName" | "chapters" | "projection" | "template">): ScreenSlide[] {
  if (!passage.projection) return [];
  const together = Math.max(1, Math.floor(passage.template?.versesPerSlide ?? 1));
  const perSlide = Math.min(PASSAGE_LINES_PER_SLIDE * together, PASSAGE_LINES_MAX);
  const slides: ScreenSlide[] = [];
  let passIndex = 0;
  for (const chapter of passage.chapters) {
    for (let at = 0; at < chapter.verses.length; at += together) {
      const verses = chapter.verses.slice(at, at + together);
      const first = verses[0]!;
      const last = verses[verses.length - 1]!;
      const end = Math.max(last.endNumber ?? last.number, last.number);
      const number = end > first.number ? `${first.number}-${end}` : `${first.number}`;
      const label = `${passage.bookName} ${chapter.chapter}:${number}`;
      const passId = `verse-${chapter.chapter}-${first.number}`;
      const text = verses.length > 1 ? verses.map((verse) => `${verse.endNumber !== undefined && verse.endNumber > verse.number ? `${verse.number}-${verse.endNumber}` : verse.number} ${verse.text}`).join(" ") : first.text;
      const lines = wrapWords(text, PASSAGE_LINE_CHARS);
      for (let line = 0, part = 0; line < lines.length; line += perSlide, part++) {
        slides.push({ passIndex, passId, label, lines: lines.slice(line, line + perSlide), part });
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
export * from "./shaders.js";
export * from "./reports.js";

export * from "./timers.js";
export * from "./day-set.js";
export * from "./widgets.js";
