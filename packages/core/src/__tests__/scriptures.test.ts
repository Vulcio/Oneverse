import { describe, expect, it } from "vite-plus/test";
import { BIBLE_BOOKS, bibleBookByOsisId, bookKey, findBibleBook } from "../scriptures/books.js";
import { BibleSchema, bibleCounts, tidyBible, type Bible } from "../scriptures/bible.js";
import { formatBibleReference, parseBibleReference, parseBibleReferences, passageVerses } from "../scriptures/references.js";

describe("books", () => {
  it("every name and abbreviation means one book", () => {
    const seen = new Map<string, number>();
    for (const info of BIBLE_BOOKS) {
      for (const name of [info.names.en, info.names.fr, info.osisId, ...info.aliases]) {
        const key = bookKey(name);
        const other = seen.get(key);
        if (other !== undefined && other !== info.number) throw new Error(`"${name}" is book ${other} and book ${info.number}`);
        seen.set(key, info.number);
      }
    }
  });

  it("finds a book by name, abbreviation, OSIS id or the start of its name", () => {
    expect(findBibleBook("John")?.number).toBe(43);
    expect(findBibleBook("jean")?.number).toBe(43);
    expect(findBibleBook("Jn.")?.number).toBe(43);
    expect(findBibleBook("1 John")?.number).toBe(62);
    expect(findBibleBook("I John")?.number).toBe(62);
    expect(findBibleBook("1er Jean")?.number).toBe(62);
    expect(findBibleBook("1Jn")?.number).toBe(62);
    expect(findBibleBook("Ésaïe")?.number).toBe(23);
    expect(findBibleBook("esaie")?.number).toBe(23);
    expect(findBibleBook("Song of Solomon")?.number).toBe(22);
    expect(findBibleBook("Cantique des cantiques")?.number).toBe(22);
    expect(findBibleBook("Philipp")?.number).toBe(50);
    expect(findBibleBook("Phile")?.number).toBe(57);
    expect(findBibleBook("Rev")?.number).toBe(66);
    expect(findBibleBook("Apocalypse")?.number).toBe(66);
    expect(bibleBookByOsisId("1kgs")?.number).toBe(11);
  });

  it("finds nothing for a start several books share, or an unknown name", () => {
    expect(findBibleBook("Jo")).toBeUndefined();
    expect(findBibleBook("Ma")).toBeUndefined();
    expect(findBibleBook("Hezekiah")).toBeUndefined();
    expect(findBibleBook("")).toBeUndefined();
  });
});

describe("parseBibleReference", () => {
  const verse = (chapter: number, verse: number | null) => ({ chapter, verse });

  it("reads verses, verse ranges, chapters and ranges across chapters", () => {
    expect(parseBibleReference("John 3:16")).toEqual({ book: 43, ranges: [{ start: verse(3, 16), end: verse(3, 16) }] });
    expect(parseBibleReference("John 3:16-18")).toEqual({ book: 43, ranges: [{ start: verse(3, 16), end: verse(3, 18) }] });
    expect(parseBibleReference("John 3")).toEqual({ book: 43, ranges: [{ start: verse(3, null), end: verse(3, null) }] });
    expect(parseBibleReference("John 3–4")).toEqual({ book: 43, ranges: [{ start: verse(3, null), end: verse(4, null) }] });
    expect(parseBibleReference("John 3:16-4:2")).toEqual({ book: 43, ranges: [{ start: verse(3, 16), end: verse(4, 2) }] });
    expect(parseBibleReference("John")).toEqual({ book: 43, ranges: [] });
  });

  it("reads lists of verses and chapters", () => {
    expect(parseBibleReference("Jn 3:16, 18; 4:1-3")).toEqual({
      book: 43,
      ranges: [
        { start: verse(3, 16), end: verse(3, 16) },
        { start: verse(3, 18), end: verse(3, 18) },
        { start: verse(4, 1), end: verse(4, 3) },
      ],
    });
  });

  it("reads French ways of writing a verse", () => {
    expect(parseBibleReference("Jean 3.16")).toEqual({ book: 43, ranges: [{ start: verse(3, 16), end: verse(3, 16) }] });
    expect(parseBibleReference("Psaume 23,1-4")).toEqual({ book: 19, ranges: [{ start: verse(23, 1), end: verse(23, 4) }] });
    expect(parseBibleReference("1 Jean 1.9")).toEqual({ book: 62, ranges: [{ start: verse(1, 9), end: verse(1, 9) }] });
  });

  it("reads a book of one chapter's number as a verse", () => {
    expect(parseBibleReference("Jude 3")).toEqual({ book: 65, ranges: [{ start: verse(1, 3), end: verse(1, 3) }] });
    expect(parseBibleReference("Jude 3-5")).toEqual({ book: 65, ranges: [{ start: verse(1, 3), end: verse(1, 5) }] });
    expect(parseBibleReference("Jude 1:3")).toEqual({ book: 65, ranges: [{ start: verse(1, 3), end: verse(1, 3) }] });
  });

  it("several books", () => {
    expect(parseBibleReferences("John 3:16; Rom 5:8")?.map((reference) => reference.book)).toEqual([43, 45]);
    expect(parseBibleReference("John 3:16; Rom 5:8")).toBeNull();
  });

  it("nothing for what it can't read", () => {
    for (const text of ["", "3:16", "Hezekiah 1:1", "John 3:18-16", "John 4-3", "John 0:1", "John 3:0", "John 3-4:2", "John 3:16,", "John 3:16-17-18"]) {
      expect(parseBibleReferences(text), text).toBeNull();
    }
  });
});

describe("formatBibleReference", () => {
  it("writes a reference back as people write it", () => {
    for (const text of ["John 3:16", "John 3:16-18", "John 3", "John 3-4", "John 3:16-4:2", "John 3:16, 18; 4:1-3", "Jude 3-5", "John"]) {
      expect(formatBibleReference(parseBibleReference(text)!)).toBe(text);
    }
  });

  it("in French, with a dot, or with the translation's own book name", () => {
    const reference = parseBibleReference("John 3:16")!;
    expect(formatBibleReference(reference, { locale: "fr", separator: "." })).toBe("Jean 3.16");
    expect(formatBibleReference(reference, { bookName: () => "S. Jean" })).toBe("S. Jean 3:16");
  });
});

const sample: Bible = {
  name: " Sample ",
  metadata: {},
  books: [
    {
      number: 43,
      name: "",
      chapters: [
        { number: 4, verses: [{ number: 1, text: "Four one" }] },
        {
          number: 3,
          verses: [
            { number: 18, text: "Eighteen" },
            { number: 16, endNumber: 17, text: "  Sixteen   and seventeen " },
            { number: 15, text: "Fifteen" },
            { number: 19, text: "  " },
          ],
        },
      ],
    },
    { number: 1, name: "Genesis", chapters: [] },
  ],
};

describe("tidyBible", () => {
  it("orders, tidies, names and leaves out what's empty", () => {
    const bible = tidyBible(sample);
    expect(bible.name).toBe("Sample");
    expect(bible.books.map((book) => [book.number, book.name, book.osisId])).toEqual([[43, "John", "John"]]);
    expect(bible.books[0]!.chapters.map((chapter) => chapter.number)).toEqual([3, 4]);
    expect(bible.books[0]!.chapters[0]!.verses.map((verse) => verse.text)).toEqual(["Fifteen", "Sixteen and seventeen", "Eighteen"]);
    expect(bibleCounts(bible)).toEqual({ books: 1, chapters: 2, verses: 4 });
  });

  it("reads a json-bible file as it is", () => {
    const parsed = BibleSchema.parse({ name: "KJV", metadata: { publisher: "", year: 1611 }, books: [{ number: 1, name: "Genesis", chapters: [{ number: 1, verses: [{ number: 1, text: "In the beginning" }] }] }] });
    expect(parsed.metadata).toEqual({ publisher: "", year: 1611 });
  });
});

describe("passageVerses", () => {
  const bible = tidyBible(sample);
  const verses = (text: string) => passageVerses(bible, parseBibleReference(text)!).map((chapter) => [chapter.chapter, chapter.verses.map((verse) => verse.number)]);

  it("the verses a reference names, a combined verse in when any of it is", () => {
    expect(verses("John 3:17")).toEqual([[3, [16]]]);
    expect(verses("John 3:16-18")).toEqual([[3, [16, 18]]]);
    expect(verses("John 3:18-4:1")).toEqual([
      [3, [18]],
      [4, [1]],
    ]);
    expect(verses("John 3")).toEqual([[3, [15, 16, 18]]]);
    expect(verses("John 3:15, 17-18")).toEqual([[3, [15, 16, 18]]]);
  });

  it("nothing the translation doesn't have", () => {
    expect(verses("John 5")).toEqual([]);
    expect(verses("Romans 1:1")).toEqual([]);
  });
});
