import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { bibleBookName, formatBibleReference, parseBibleReference, passageVerses, readItemPassage, type BibleReference, type BibleSourceFormat, type PassageChapter, type SetItemPassage } from "@oneverse/core";
import type { Bible as BibleRow, BibleStatus } from "@oneverse/db";
import type { Queue } from "bullmq";
import { YouVersionService } from "./youversion.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { SCRIPTURES_QUEUE, type BibleImportJobData, type ImportedBibleBook } from "./bibles.types.js";

/** What an imported Bible may be used for beyond being read (issue #301), the admin's to say. */
export interface BibleRights {
  projection: boolean;
  offline: boolean;
  export: boolean;
}

export interface ImportedBible {
  id: string;
  name: string;
  abbreviation: string | null;
  language: string | null;
  copyright: string | null;
  books: ImportedBibleBook[];
  rights: BibleRights;
}

/** As Admin > Bibles lists it: how its import went, too. */
export interface AdminBible extends ImportedBible {
  status: BibleStatus;
  error: string | null;
  sourceFormat: BibleSourceFormat | null;
  verseCount: number;
  createdAt: Date;
}

export interface BiblePassage {
  /** As people write it, with the translation's own book name. */
  reference: string;
  bible: Pick<ImportedBible, "id" | "name" | "abbreviation" | "copyright">;
  chapters: PassageChapter[];
  rights: BibleRights;
}

export interface BibleUpdate {
  name?: string;
  abbreviation?: string | null;
  copyright?: string | null;
  canProject?: boolean;
  canOffline?: boolean;
  canExport?: boolean;
}

/**
 * What a set's passage is read for (issue #301), each with the right it needs
 * for its verses: shown to whoever opens the set (none), kept on a device
 * (offline), shown on screens (projection); the set's list only names it.
 */
export type PassageUse = "list" | "read" | "offline" | "screen";

/** Imported Bible files are their own size: a whole Bible in OSIS XML is tens of megabytes. */
export const MAX_BIBLE_FILE_BYTES = 64 * 1024 * 1024;

const rightsOf = (row: BibleRow): BibleRights => ({ projection: row.canProject, offline: row.canOffline, export: row.canExport });

function shown(row: BibleRow): ImportedBible {
  return {
    id: row.id,
    name: row.name,
    abbreviation: row.abbreviation,
    language: row.language,
    copyright: row.copyright,
    books: (row.books as unknown as ImportedBibleBook[]) ?? [],
    rights: rightsOf(row),
  };
}

/**
 * Bibles imported from files (issue #301), for everyone on the server: the
 * admin uploads one, the Worker converts it (BibleImportProcessor), and its
 * verses are read by reference. What they may be used for - projected,
 * kept offline, exported - is off until the admin, who knows its licence,
 * says otherwise.
 */
@Injectable()
export class BiblesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly youversion: YouVersionService,
    @InjectQueue(SCRIPTURES_QUEUE) private readonly queue: Queue<BibleImportJobData>,
  ) {}

  /** Keeps the file and leaves it to the Worker; the Bible shows as importing until it's read. */
  async import(file: { buffer: Buffer; originalname: string; mimetype: string }): Promise<AdminBible> {
    if (file.buffer.length === 0) throw new BadRequestException(["file must not be empty"]);
    const { hash } = await this.storage.put(file.buffer, file.mimetype || "application/octet-stream");
    const name = file.originalname.replace(/\.[^.]+$/, "").trim().slice(0, 200) || "Bible";
    const row = await this.prisma.client.bible.create({ data: { name, sourceStorageKey: hash } });
    await this.queue.add("import-bible", { bibleId: row.id }, { attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
    return this.adminShown(row);
  }

  /** The Bibles anyone can read: imported, without a failed or pending one. */
  async list(): Promise<ImportedBible[]> {
    const rows = await this.prisma.client.bible.findMany({ where: { status: "READY" }, orderBy: { name: "asc" } });
    return rows.map(shown);
  }

  async adminList(): Promise<AdminBible[]> {
    const rows = await this.prisma.client.bible.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map((row) => this.adminShown(row));
  }

  async update(id: string, change: BibleUpdate): Promise<AdminBible> {
    // Its details come from the file: changed once it's read.
    if ((await this.find(id)).status === "IMPORTING") throw new BadRequestException(["The Bible is still being imported"]);
    const row = await this.prisma.client.bible.update({ where: { id }, data: change });
    return this.adminShown(row);
  }

  /** The Bible and its verses; its file, if it was never imported, when nothing else has the same bytes. */
  async remove(id: string): Promise<void> {
    const row = await this.find(id);
    await this.prisma.client.bible.delete({ where: { id } });
    if (row.sourceStorageKey) await this.storage.deleteUnreferenced([row.sourceStorageKey]);
  }

  /** A passage, as people write it, in an imported Bible: one book, chapters or verses. */
  async passage(id: string, text: string): Promise<BiblePassage> {
    const row = await this.prisma.client.bible.findFirst({ where: { id, status: "READY" } });
    if (!row) throw new NotFoundException("Bible not found");
    const reference = parseBibleReference(text);
    if (!reference) throw new BadRequestException(["reference must be a passage of one book, like John 3:16-18"]);
    if (reference.ranges.length === 0) throw new BadRequestException(["reference must be a chapter or verses, not a whole book"]);
    const bible = shown(row);
    const book = bible.books.find((candidate) => candidate.number === reference.book);
    if (!book) throw new NotFoundException(`${bible.name} has no ${formatBibleReference({ book: reference.book, ranges: [] })}`);
    const found = await this.chaptersOf(bible, book, reference);
    if (found.length === 0) throw new NotFoundException(`${bible.name} has no verses at ${formatBibleReference(reference, { bookName: () => book.name })}`);
    return {
      reference: formatBibleReference(reference, { bookName: () => book.name }),
      bible: { id: bible.id, name: bible.name, abbreviation: bible.abbreviation, copyright: bible.copyright },
      chapters: found,
      rights: bible.rights,
    };
  }

  /**
   * A set's passage item as `use` may have it (issue #301): its Bible and
   * reference, and its verses only where the Bible's rights allow that use.
   * A Bible deleted since leaves the reference, with no Bible and no verses.
   */
  async itemPassage(value: unknown, use: PassageUse): Promise<SetItemPassage | null> {
    const ref = readItemPassage(value);
    if (!ref) return null;
    // A YouVersion version's (issue #310): read from YouVersion, never kept.
    if (ref.youversionId !== undefined) return this.youversion.itemPassage(ref.youversionId, ref.reference, use);
    if (!ref.bibleId) return null;
    const row = await this.prisma.client.bible.findFirst({ where: { id: ref.bibleId, status: "READY" } });
    const reference = parseBibleReference(ref.reference);
    const bible = row ? shown(row) : null;
    const book = reference ? bible?.books.find((candidate) => candidate.number === reference.book) : undefined;
    const passage: SetItemPassage = {
      bibleId: ref.bibleId,
      reference: ref.reference,
      bookName: book?.name ?? (reference ? bibleBookName(reference.book, "en") : ""),
      bible: bible ? { name: bible.name, abbreviation: bible.abbreviation, copyright: bible.copyright } : null,
      chapters: [],
      projection: !!bible?.rights.projection,
    };
    const allowed = use === "read" || (use === "offline" && bible?.rights.offline) || (use === "screen" && bible?.rights.projection);
    if (!bible || !reference || !book || !allowed) return passage;
    return { ...passage, chapters: await this.chaptersOf(bible, book, reference) };
  }

  /** A reference's verses in a Bible, chapter by chapter: the book's chapters it names, read, and cut by core. */
  private async chaptersOf(bible: ImportedBible, book: ImportedBibleBook, reference: BibleReference): Promise<PassageChapter[]> {
    const chapters = new Set<number>();
    for (const { start, end } of reference.ranges) for (let chapter = start.chapter; chapter <= Math.min(end.chapter, book.chapters); chapter++) chapters.add(chapter);
    const verses = await this.prisma.client.bibleVerse.findMany({
      where: { bibleId: bible.id, book: reference.book, chapter: { in: [...chapters] } },
      orderBy: [{ chapter: "asc" }, { verse: "asc" }],
    });
    // The book alone, as a Bible of its own, for core to cut the passage from.
    const byChapter = new Map<number, { number: number; verses: { number: number; endNumber?: number; text: string }[] }>();
    for (const verse of verses) {
      let chapter = byChapter.get(verse.chapter);
      if (!chapter) byChapter.set(verse.chapter, (chapter = { number: verse.chapter, verses: [] }));
      chapter.verses.push({ number: verse.verse, ...(verse.endVerse !== null ? { endNumber: verse.endVerse } : {}), text: verse.text });
    }
    return passageVerses({ name: bible.name, metadata: {}, books: [{ number: book.number, name: book.name, chapters: [...byChapter.values()] }] }, reference);
  }

  private async find(id: string): Promise<BibleRow> {
    const row = await this.prisma.client.bible.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Bible not found");
    return row;
  }

  private adminShown(row: BibleRow): AdminBible {
    return {
      ...shown(row),
      status: row.status,
      error: row.error,
      sourceFormat: (row.sourceFormat as BibleSourceFormat | null) ?? null,
      verseCount: row.verseCount,
      createdAt: row.createdAt,
    };
  }
}
