import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { formatBibleReference, parseBibleReference, passageVerses, type BibleSourceFormat, type PassageChapter } from "@oneverse/core";
import type { Bible as BibleRow, BibleStatus } from "@oneverse/db";
import type { Queue } from "bullmq";
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
    const chapters = new Set<number>();
    for (const { start, end } of reference.ranges) for (let chapter = start.chapter; chapter <= Math.min(end.chapter, book.chapters); chapter++) chapters.add(chapter);
    const verses = await this.prisma.client.bibleVerse.findMany({
      where: { bibleId: id, book: reference.book, chapter: { in: [...chapters] } },
      orderBy: [{ chapter: "asc" }, { verse: "asc" }],
    });
    // The book alone, as a Bible of its own, for core to cut the passage from.
    const byChapter = new Map<number, { number: number; verses: { number: number; endNumber?: number; text: string }[] }>();
    for (const verse of verses) {
      let chapter = byChapter.get(verse.chapter);
      if (!chapter) byChapter.set(verse.chapter, (chapter = { number: verse.chapter, verses: [] }));
      chapter.verses.push({ number: verse.verse, ...(verse.endVerse !== null ? { endNumber: verse.endVerse } : {}), text: verse.text });
    }
    const found = passageVerses({ name: bible.name, metadata: {}, books: [{ number: book.number, name: book.name, chapters: [...byChapter.values()] }] }, reference);
    if (found.length === 0) throw new NotFoundException(`${bible.name} has no verses at ${formatBibleReference(reference, { bookName: () => book.name })}`);
    return {
      reference: formatBibleReference(reference, { bookName: () => book.name }),
      bible: { id: bible.id, name: bible.name, abbreviation: bible.abbreviation, copyright: bible.copyright },
      chapters: found,
      rights: bible.rights,
    };
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
