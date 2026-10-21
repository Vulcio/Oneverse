/**
 * USFM's book ids ("GEN", "JHN"), the ones YouVersion's Platform API names
 * books and passages by (issue #304), and a reference cut into what can be
 * asked for there: a whole chapter ("JHN.3"), or a chapter's verses.
 */
import { bibleBook } from "./books.js";
import type { BibleReference } from "./references.js";

/** By book number, as books.ts numbers them (1-66, then the deuterocanonical books from 67). */
const USFM_IDS: readonly string[] = [
  ...["GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI", "1CH", "2CH", "EZR", "NEH", "EST", "JOB", "PSA", "PRO", "ECC", "SNG"],
  ...["ISA", "JER", "LAM", "EZK", "DAN", "HOS", "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL"],
  ...["MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS"],
  ...["1PE", "2PE", "1JN", "2JN", "3JN", "JUD", "REV"],
  ...["JDT", "WIS", "TOB", "SIR", "BAR", "1MA", "2MA"],
];

/** A book's USFM id ("JHN" for 43); undefined for a book books.ts doesn't know. */
export function usfmBookId(number: number): string | undefined {
  return bibleBook(number) ? USFM_IDS[number - 1] : undefined;
}

/** A book's number from its USFM id, case ignored; undefined for one not in the list. */
export function bibleBookByUsfm(id: string): number | undefined {
  const index = USFM_IDS.indexOf(id.toUpperCase());
  return index < 0 ? undefined : index + 1;
}

/**
 * One chapter of a passage, as it's asked for: the whole chapter (`from`
 * and `to` null), or its verses from `from` (null: the first) to `to`
 * (null: the last).
 */
export interface UsfmChapterPart {
  book: string;
  chapter: number;
  from: number | null;
  to: number | null;
}

/**
 * A reference's chapters, in the order written: "John 3:16-4:2" is John 3
 * from verse 16, then John 4 to verse 2. Null for a book USFM's list
 * doesn't have, or a whole book (no ranges), which is too long to ask for.
 */
export function usfmChapterParts(reference: BibleReference): UsfmChapterPart[] | null {
  const book = usfmBookId(reference.book);
  if (!book || reference.ranges.length === 0) return null;
  const parts: UsfmChapterPart[] = [];
  for (const { start, end } of reference.ranges) {
    for (let chapter = start.chapter; chapter <= end.chapter; chapter++) {
      parts.push({ book, chapter, from: chapter === start.chapter ? start.verse : null, to: chapter === end.chapter ? end.verse : null });
    }
  }
  return parts;
}

/** A chapter's or a verse's USFM passage id: "JHN.3", "JHN.3.16". */
export function usfmPassageId(book: string, chapter: number, verse?: number): string {
  return verse === undefined ? `${book}.${chapter}` : `${book}.${chapter}.${verse}`;
}
