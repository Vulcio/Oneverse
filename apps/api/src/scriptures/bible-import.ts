/**
 * A Bible file read into the json-bible format (issue #301): Zefania XML,
 * Beblia XML, OSIS XML or a json-bible file, told apart by their content.
 * Notes, cross-references and headings are left out: a verse is its text.
 */
import { BibleSchema, bibleBook, bibleBookByOsisId, tidyBible, type Bible, type BibleBook, type BibleMetadata, type BibleSourceFormat } from "@oneverse/core";
import { readXml, XmlError, type XmlHandler } from "./xml-reader.js";

export class BibleImportError extends Error {}

/** Which format a file is in, from its first element (or a JSON object); null for none of them. */
export function detectBibleFormat(text: string): BibleSourceFormat | null {
  const start = text.replace(/^﻿/, "").trimStart();
  if (start.startsWith("{")) return "json-bible";
  // The first element that isn't the declaration, a comment or the DOCTYPE.
  const root = /^(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|\s)*<([\w:.-]+)/i.exec(start)?.[1];
  switch (root?.slice(root.indexOf(":") + 1).toLowerCase()) {
    case "xmlbible":
      return "zefania";
    case "bible":
      return "beblia";
    case "osis":
      return "osis";
    default:
      return null;
  }
}

const int = (value: string | undefined): number | null => {
  const number = value === undefined ? Number.NaN : Number.parseInt(value.trim(), 10);
  return Number.isInteger(number) && number >= 0 ? number : null;
};

/** Books, chapters and verses as a file gives them, in any order, verses' text appended to. */
class BibleBuilder {
  readonly books = new Map<number, BibleBook>();

  book(number: number, name: string, osisId?: string): BibleBook {
    let book = this.books.get(number);
    if (!book) {
      book = { number, name, ...(osisId ? { osisId } : {}), chapters: [] };
      this.books.set(number, book);
    }
    return book;
  }

  verse(book: BibleBook, chapterNumber: number, number: number, endNumber?: number) {
    let chapter = book.chapters.find((candidate) => candidate.number === chapterNumber);
    if (!chapter) {
      chapter = { number: chapterNumber, verses: [] };
      book.chapters.push(chapter);
    }
    const verse = { number, ...(endNumber !== undefined && endNumber > number ? { endNumber } : {}), text: "" };
    chapter.verses.push(verse);
    return verse;
  }

  bible(name: string, metadata: BibleMetadata): Bible {
    return tidyBible({ name, metadata, books: [...this.books.values()] });
  }
}

/** Whether text is inside one of the elements left out (a note, a heading). Sees every open and close. */
class Skipper {
  private depth = 0;
  constructor(private readonly skipped: (name: string, attributes: Record<string, string>) => boolean) {}
  open(name: string, attributes: Record<string, string>) {
    if (this.depth > 0 || this.skipped(name, attributes)) this.depth++;
  }
  close() {
    if (this.depth > 0) this.depth--;
  }
  get skipping() {
    return this.depth > 0;
  }
}

/** The text inside an element, for a translation's details. */
function collectText(names: string[]) {
  const found: Record<string, string> = {};
  let current: string | null = null;
  return {
    open(name: string) {
      if (names.includes(name) && found[name] === undefined) current = name;
    },
    close(name: string) {
      if (name === current) current = null;
    },
    text(text: string) {
      if (current) found[current] = (found[current] ?? "") + text;
    },
    get(name: string) {
      const value = found[name]?.replace(/\s+/g, " ").trim();
      return value ? value : undefined;
    },
  };
}

const LINE_BREAKS = new Set(["br", "lb"]);

function readZefania(xml: string): Bible {
  const builder = new BibleBuilder();
  let name = "";
  const information = collectText(["title", "identifier", "language", "rights", "publisher"]);
  let inInformation = false;
  let book: BibleBook | null = null;
  let chapter: number | null = null;
  let verse: { text: string } | null = null;
  const skipper = new Skipper((element) => element === "note" || element === "xref" || element === "caption" || element === "prolog");
  const handler: XmlHandler = {
    open(element, attributes) {
      skipper.open(element, attributes);
      if (element === "xmlbible") name = attributes.biblename ?? "";
      else if (element === "information") inInformation = true;
      else if (inInformation) information.open(element);
      else if (element === "biblebook") {
        const number = int(attributes.bnumber);
        if (number === null || number < 1) throw new BibleImportError("A BIBLEBOOK has no bnumber.");
        book = builder.book(number, attributes.bname ?? attributes.bsname ?? "");
      } else if (element === "chapter") chapter = int(attributes.cnumber);
      else if (element === "vers" && book && chapter !== null && !verse) {
        const number = int(attributes.vnumber);
        if (number !== null) verse = builder.verse(book, chapter, number);
      } else if (verse && LINE_BREAKS.has(element) && !skipper.skipping) verse.text += " ";
    },
    close(element) {
      skipper.close();
      if (element === "information") inInformation = false;
      else if (inInformation) information.close(element);
      else if (element === "vers" && !skipper.skipping) verse = null;
      else if (element === "chapter") chapter = null;
      else if (element === "biblebook") book = null;
    },
    text(text) {
      if (inInformation) information.text(text);
      else if (verse && !skipper.skipping) verse.text += text;
    },
  };
  readXml(xml, handler);
  return builder.bible(name || information.get("title") || "", {
    ...(information.get("identifier") ? { abbreviation: information.get("identifier") } : {}),
    ...(information.get("language") ? { language: information.get("language") } : {}),
    ...(information.get("rights") ? { copyright: information.get("rights") } : {}),
    ...(information.get("publisher") ? { publisher: information.get("publisher") } : {}),
    sourceFormat: "zefania",
  });
}

function readBeblia(xml: string): Bible {
  const builder = new BibleBuilder();
  let name = "";
  const metadata: BibleMetadata = { sourceFormat: "beblia" };
  let book: BibleBook | null = null;
  let chapter: number | null = null;
  let verse: { text: string } | null = null;
  readXml(xml, {
    open(element, attributes) {
      if (element === "bible") {
        name = attributes.translation ?? attributes.name ?? "";
        if (attributes.language) metadata.language = attributes.language;
        if (attributes.copyright ?? attributes.status) metadata.copyright = attributes.copyright ?? attributes.status;
        if (attributes.link) metadata.link = attributes.link;
      } else if (element === "book") {
        const number = int(attributes.number);
        if (number === null || number < 1) throw new BibleImportError("A book has no number.");
        book = builder.book(number, attributes.name ?? "");
      } else if (element === "chapter") chapter = int(attributes.number);
      else if (element === "verse" && book && chapter !== null) {
        const number = int(attributes.number);
        verse = number === null ? null : builder.verse(book, chapter, number);
      } else if (verse && LINE_BREAKS.has(element)) verse.text += " ";
    },
    close(element) {
      if (element === "verse") verse = null;
      else if (element === "chapter") chapter = null;
      else if (element === "book") book = null;
    },
    text(text) {
      if (verse) verse.text += text;
    },
  });
  return builder.bible(name, metadata);
}

/** "Gen.1.1" (or "Bible.KJV:Gen.1.1"): a verse's book, chapter and number. */
function osisVerse(osisId: string): { book: string; chapter: number; verse: number } | null {
  const match = /^(?:[^:]*:)?([^.\s]+)\.(\d+)\.(\d+)/.exec(osisId.trim());
  return match ? { book: match[1]!, chapter: Number(match[2]), verse: Number(match[3]) } : null;
}

function readOsis(xml: string): Bible {
  const builder = new BibleBuilder();
  const metadata: BibleMetadata = { sourceFormat: "osis" };
  const work = collectText(["title", "rights", "publisher", "identifier"]);
  let inHeader = false;
  let inWork = false;
  const unknownBooks = new Map<string, number>();
  let verse: { text: string } | null = null;
  // Every element's depth; the verse open as an element (not a milestone), and the book's div, by theirs.
  let depth = 0;
  let verseDepth: number | null = null;
  let bookDepth: number | null = null;
  const skipper = new Skipper((element, attributes) => element === "note" || (element === "title" && attributes.canonical !== "true"));

  const bookOf = (osisId: string): BibleBook => {
    const known = bibleBookByOsisId(osisId);
    if (known) return builder.book(known.number, "", known.osisId);
    let number = unknownBooks.get(osisId);
    if (number === undefined) {
      number = 1000 + unknownBooks.size;
      unknownBooks.set(osisId, number);
    }
    return builder.book(number, osisId, osisId);
  };
  const startVerse = (osisIds: string) => {
    const ids = osisIds.split(/\s+/).map(osisVerse).filter((id) => id !== null);
    const first = ids[0];
    if (!first) return (verse = null);
    const last = ids[ids.length - 1]!;
    verse = builder.verse(bookOf(first.book), first.chapter, first.verse, last.chapter === first.chapter ? last.verse : undefined);
  };

  readXml(xml, {
    open(element, attributes, selfClosing) {
      depth++;
      if (element === "osistext") {
        if (attributes.lang) metadata.language = attributes.lang;
        if (attributes.osisidwork) metadata.abbreviation = attributes.osisidwork;
      }
      if (element === "header") inHeader = true;
      if (inHeader) {
        if (element === "work" && !inWork && work.get("title") === undefined) inWork = true;
        if (inWork) work.open(element);
        return;
      }
      skipper.open(element, attributes);
      if (element === "verse") {
        if (attributes.eid !== undefined) {
          verse = null;
        } else if (attributes.osisid || attributes.sid) {
          startVerse(attributes.osisid ?? attributes.sid!);
          verseDepth = selfClosing ? null : depth;
        }
      } else if (element === "div" && attributes.type === "book") {
        verse = null;
        bookDepth = depth;
      } else if (element === "chapter" && attributes.eid !== undefined) {
        verse = null;
      } else if (verse && LINE_BREAKS.has(element) && !skipper.skipping) {
        verse.text += " ";
      }
    },
    close(element) {
      if (inHeader) {
        if (inWork) work.close(element);
        if (element === "work") inWork = false;
        if (element === "header") inHeader = false;
      } else {
        skipper.close();
        // A verse element's end, or a chapter's or a book's: the end of a milestone verse still open too.
        if ((element === "verse" && depth === verseDepth) || element === "chapter" || (element === "div" && depth === bookDepth)) {
          verse = null;
          verseDepth = null;
        }
      }
      depth--;
    },
    text(text) {
      if (inWork) work.text(text);
      else if (verse && !skipper.skipping) verse.text += text;
    },
  });
  const name = work.get("title") ?? metadata.abbreviation ?? "";
  if (work.get("rights")) metadata.copyright = work.get("rights");
  if (work.get("publisher")) metadata.publisher = work.get("publisher");
  return builder.bible(name, metadata);
}

function readJsonBible(text: string): Bible {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new BibleImportError("The file isn't valid JSON.");
  }
  const parsed = BibleSchema.safeParse(json);
  if (!parsed.success) throw new BibleImportError("The file isn't a json-bible file: it needs a name and books of chapters of verses.");
  const bible = tidyBible(parsed.data);
  return { ...bible, metadata: { ...bible.metadata, sourceFormat: bible.metadata.sourceFormat ?? "json-bible" } };
}

/**
 * A Bible file read into the json-bible format. Throws a BibleImportError,
 * worded for whoever imports it, when the file is none of the formats, isn't
 * well formed, or holds no verse.
 */
export function importBible(text: string): Bible {
  const format = detectBibleFormat(text);
  if (!format) throw new BibleImportError("The file isn't a Zefania, Beblia, OSIS or json-bible file.");
  let bible: Bible;
  try {
    bible = format === "zefania" ? readZefania(text) : format === "beblia" ? readBeblia(text) : format === "osis" ? readOsis(text) : readJsonBible(text);
  } catch (error) {
    if (error instanceof XmlError) throw new BibleImportError(`The file isn't well-formed XML: ${error.message}`);
    throw error;
  }
  if (bible.books.length === 0) throw new BibleImportError("The file holds no verse.");
  // Books the file didn't name are named in English, as tidyBible does; a known book keeps its OSIS id.
  for (const book of bible.books) if (!book.osisId && bibleBook(book.number)) book.osisId = bibleBook(book.number)!.osisId;
  return bible;
}
