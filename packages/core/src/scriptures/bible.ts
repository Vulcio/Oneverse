/**
 * A Bible translation's text (issue #301), in the json-bible format
 * (github.com/ChurchApps/json-bible, FreeShow's): books, chapters, verses,
 * with a few fields of our own that json-bible readers ignore - each book's
 * OSIS id, the translation's abbreviation and language, and the format it
 * was imported from. Imported files are converted to it; it's what's stored.
 */
import { z } from "zod";
import { bibleBook } from "./books.js";

export const BIBLE_SOURCE_FORMATS = ["zefania", "beblia", "osis", "json-bible"] as const;
export type BibleSourceFormat = (typeof BIBLE_SOURCE_FORMATS)[number];

export const BibleVerseSchema = z.object({
  number: z.number().int().min(0),
  /** The last verse of verses printed together ("16-17"). */
  endNumber: z.number().int().min(0).optional(),
  text: z.string(),
});

export const BibleChapterSchema = z.object({
  number: z.number().int().min(1),
  header: z.string().optional(),
  verses: z.array(BibleVerseSchema),
});

export const BibleBookSchema = z.object({
  number: z.number().int().min(1),
  name: z.string(),
  osisId: z.string().optional(),
  chapters: z.array(BibleChapterSchema),
});

export const BibleMetadataSchema = z
  .object({
    abbreviation: z.string().optional(),
    /** A BCP 47 tag ("en", "fr"), as the file gives it. */
    language: z.string().optional(),
    copyright: z.string().optional(),
    publisher: z.string().optional(),
    sourceFormat: z.enum(BIBLE_SOURCE_FORMATS).optional(),
  })
  .catchall(z.unknown());

export const BibleSchema = z.object({
  name: z.string(),
  metadata: BibleMetadataSchema.default({}),
  books: z.array(BibleBookSchema),
});

export type BibleVerse = z.infer<typeof BibleVerseSchema>;
export type BibleChapter = z.infer<typeof BibleChapterSchema>;
export type BibleBook = z.infer<typeof BibleBookSchema>;
export type BibleMetadata = z.infer<typeof BibleMetadataSchema>;
export type Bible = z.infer<typeof BibleSchema>;

/**
 * Spaces, tabs and line breaks as one space, none around the text; a no-break
 * space (French "vide\u00a0:") is kept. json-bible's markdown is left as it is.
 */
export function tidyVerseText(text: string): string {
  return text.replace(/[ \t\r\n]+/g, " ").replace(/^ | $/g, "");
}

const byNumber = <T extends { number: number }>(a: T, b: T) => a.number - b.number;

/**
 * A Bible put in order, as every importer leaves it: books, chapters and
 * verses by number, text tidied, empty verses, chapters and books left out,
 * a book's name and OSIS id filled in from the book list when the file had none.
 */
export function tidyBible(bible: Bible): Bible {
  const books = bible.books
    .map((source) => {
      const known = bibleBook(source.number);
      const chapters = source.chapters
        .map((chapter) => ({
          ...chapter,
          verses: chapter.verses.map((verse) => ({ ...verse, text: tidyVerseText(verse.text) })).filter((verse) => verse.text !== "").sort(byNumber),
        }))
        .filter((chapter) => chapter.verses.length > 0)
        .sort(byNumber);
      const name = source.name.trim() || known?.names.en || String(source.number);
      const osisId = source.osisId ?? known?.osisId;
      return { number: source.number, name, ...(osisId ? { osisId } : {}), chapters };
    })
    .filter((book) => book.chapters.length > 0)
    .sort(byNumber);
  return { name: bible.name.trim(), metadata: bible.metadata, books };
}

/** How much a Bible holds, for listing it. */
export function bibleCounts(bible: Bible): { books: number; chapters: number; verses: number } {
  const chapters = bible.books.flatMap((book) => book.chapters);
  return { books: bible.books.length, chapters: chapters.length, verses: chapters.reduce((sum, chapter) => sum + chapter.verses.length, 0) };
}
