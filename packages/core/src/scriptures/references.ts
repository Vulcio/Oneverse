/**
 * Bible references (issue #301): "John 3:16-18", "Jn 3:16, 18; 4:1-3",
 * "Jean 3.16", "Psaume 23,1-4", "Jude 3" - read into a book and its ranges,
 * written back, and resolved against a translation. A set holds a passage
 * as a reference and a translation, never a copy of its text.
 */
import { bibleBook, bibleBookName, findBibleBook, type BibleBookLocale } from "./books.js";
import type { Bible, BibleVerse } from "./bible.js";

/** A place in a book: a chapter, and a verse or none (the whole chapter). */
export interface BiblePoint {
  chapter: number;
  verse: number | null;
}

/** From `start` to `end`, both included: a verse, verses, a chapter or chapters. */
export interface BibleRange {
  start: BiblePoint;
  end: BiblePoint;
}

export interface BibleReference {
  book: number;
  /** In the order written; none: the whole book. */
  ranges: BibleRange[];
}

const DASH = /\s*[-–—]\s*/;
// A book, then what's after it: "1 John 3:16", "1Jn3.16", "Song of Songs 2".
const BOOK_AND_REST = /^\s*((?:[1-3]|i{1,3})?\s*\p{L}[\p{L}\s.'’]*?)\.?\s*(\d[\d\s:.,;\-–—]*)?\s*$/iu;

function point(text: string): BiblePoint | null {
  const match = /^(\d+)(?:\s*[:.]\s*(\d+))?$/.exec(text.trim());
  if (!match) return null;
  return { chapter: Number(match[1]), verse: match[2] === undefined ? null : Number(match[2]) };
}

function before(a: BiblePoint, b: BiblePoint): boolean {
  if (a.chapter !== b.chapter) return a.chapter < b.chapter;
  return (a.verse ?? 0) <= (b.verse ?? Number.MAX_SAFE_INTEGER);
}

/**
 * One part of a chapter's list: "16", "16-18", "3:16", "3:16-4:2", "3-4".
 * `chapter`: the chapter verses are in, once one was given; null before.
 */
function rangeOf(part: string, chapter: number | null, oneChapter: boolean): BibleRange | null {
  const [from, to, ...more] = part.split(DASH);
  if (from === undefined || more.length > 0) return null;
  const parsePoint = (text: string, inChapter: number | null): BiblePoint | null => {
    const read = point(text);
    if (!read) return null;
    // A bare number is a verse once a chapter's verses are listed, and in a book of one chapter.
    if (read.verse === null && inChapter !== null) return { chapter: inChapter, verse: read.chapter };
    return read;
  };
  const context = chapter ?? (oneChapter ? 1 : null);
  const start = parsePoint(from, context);
  if (!start) return null;
  let end: BiblePoint | null = start;
  if (to !== undefined) {
    // "3:16-18": 18 is a verse of chapter 3; "3-4": chapters.
    end = parsePoint(to, start.verse === null ? null : start.chapter);
    if (!end) return null;
    if (start.verse === null && end.verse !== null) return null;
  }
  if (start.chapter < 1 || end.chapter < 1 || start.verse === 0 || end.verse === 0) return null;
  return before(start, end) ? { start, end } : null;
}

/**
 * The passages `text` names, book by book: "John 3:16; Rom 5:8" is two.
 * A semicolon starts another chapter (or, with a name, another book); a
 * comma another verse or verses of the same chapter. "23,1" with no colon
 * or dot is chapter 23, verse 1, as French writes it. Null when any part
 * can't be read or a book isn't known; a book alone is the whole book.
 */
export function parseBibleReferences(text: string): BibleReference[] | null {
  const references: BibleReference[] = [];
  for (const segment of text.split(";")) {
    if (!segment.trim()) continue;
    const named = BOOK_AND_REST.exec(segment);
    const current = references[references.length - 1];
    let reference: BibleReference;
    let rest: string;
    if (named && /\p{L}/u.test(named[1]!)) {
      const info = findBibleBook(named[1]!);
      if (!info) return null;
      reference = { book: info.number, ranges: [] };
      references.push(reference);
      rest = named[2] ?? "";
    } else if (current && /^\s*\d/.test(segment)) {
      reference = current;
      rest = segment;
    } else {
      return null;
    }
    if (!rest.trim()) continue;
    const oneChapter = bibleBook(reference.book)?.oneChapter === true;
    let parts = rest.split(",").map((part) => part.trim());
    if (parts.some((part) => part === "")) return null;
    // "Psaume 23,1-4": chapter 23, verses 1-4.
    if (!/[:.]/.test(rest) && parts.length > 1 && /^\d+$/.test(parts[0]!) && !oneChapter) {
      parts = [`${parts[0]}:${parts[1]}`, ...parts.slice(2)];
    }
    let chapter: number | null = null;
    for (const part of parts) {
      const range = rangeOf(part, chapter, oneChapter);
      if (!range) return null;
      reference.ranges.push(range);
      chapter = range.end.verse === null ? null : range.end.chapter;
    }
  }
  return references.length > 0 ? references : null;
}

/** The one passage `text` names; null when it names none or several books. */
export function parseBibleReference(text: string): BibleReference | null {
  const references = parseBibleReferences(text);
  return references?.length === 1 ? references[0]! : null;
}

export interface FormatReferenceOptions {
  locale?: BibleBookLocale;
  /** Between a chapter and its verse: ":" by default, "." as many French Bibles print it. */
  separator?: ":" | ".";
  /** The translation's own name for a book, when it has one. */
  bookName?: (book: number) => string | undefined;
}

/** A reference as people write it: "John 3:16-18, 20; 4:1". */
export function formatBibleReference(reference: BibleReference, options: FormatReferenceOptions = {}): string {
  const separator = options.separator ?? ":";
  const locale = options.locale ?? "en";
  const info = bibleBook(reference.book);
  const name = options.bookName?.(reference.book) ?? bibleBookName(reference.book, locale);
  const at = ({ chapter, verse }: BiblePoint) => (verse === null ? `${chapter}` : info?.oneChapter && chapter === 1 ? `${verse}` : `${chapter}${separator}${verse}`);
  let text = "";
  let chapter: number | null = null;
  for (const { start, end } of reference.ranges) {
    const sameChapter = chapter !== null && start.verse !== null && start.chapter === chapter;
    const first = sameChapter ? `${start.verse}` : at(start);
    const last = end.chapter === start.chapter && start.verse !== null && end.verse !== null ? `${end.verse}` : at(end);
    const range = start.chapter === end.chapter && start.verse === end.verse ? first : `${first}-${last}`;
    text += text === "" ? range : sameChapter ? `, ${range}` : `; ${range}`;
    chapter = end.verse === null ? null : end.chapter;
  }
  return text ? `${name} ${text}` : name;
}

export interface PassageChapter {
  book: number;
  chapter: number;
  verses: BibleVerse[];
}

/**
 * A reference's verses in `bible`, chapter by chapter, in the order written:
 * a verse printed with others ("16-17") is in when any of them is. Chapters
 * or verses the translation doesn't have are left out; nothing at all when
 * it lacks the book.
 */
export function passageVerses(bible: Bible, reference: BibleReference): PassageChapter[] {
  const book = bible.books.find((candidate) => candidate.number === reference.book);
  if (!book) return [];
  const ranges = reference.ranges.length > 0 ? reference.ranges : [{ start: { chapter: 1, verse: null }, end: { chapter: Number.MAX_SAFE_INTEGER, verse: null } }];
  const passage: PassageChapter[] = [];
  for (const { start, end } of ranges) {
    for (const chapter of book.chapters) {
      if (chapter.number < start.chapter || chapter.number > end.chapter) continue;
      const from = chapter.number === start.chapter ? (start.verse ?? 0) : 0;
      const to = chapter.number === end.chapter ? (end.verse ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
      const verses = chapter.verses.filter((verse) => (verse.endNumber ?? verse.number) >= from && verse.number <= to);
      if (verses.length === 0) continue;
      const last = passage[passage.length - 1];
      if (last && last.chapter === chapter.number) {
        for (const verse of verses) if (!last.verses.includes(verse)) last.verses.push(verse);
      } else {
        passage.push({ book: book.number, chapter: chapter.number, verses });
      }
    }
  }
  return passage;
}
