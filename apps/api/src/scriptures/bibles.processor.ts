import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { JOB_WORKER_OPTIONS } from "../jobs/jobs.constants.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { BibleImportError, importBible } from "./bible-import.js";
import { SCRIPTURES_QUEUE, type BibleImportJobData, type ImportedBibleBook } from "./bibles.types.js";

/** Verses written at once: a whole Bible is about 31,000. */
const VERSES_PER_WRITE = 5000;

/**
 * Converts an uploaded Bible file (issue #301) - Zefania, Beblia, OSIS or
 * json-bible - and keeps its verses. The file is deleted once read, either
 * way; a file that can't be read leaves the Bible failed, with why.
 */
@Processor(SCRIPTURES_QUEUE, JOB_WORKER_OPTIONS)
export class BibleImportProcessor extends WorkerHost {
  private readonly logger = new Logger(BibleImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<BibleImportJobData>): Promise<void> {
    const row = await this.prisma.client.bible.findUnique({ where: { id: job.data.bibleId } });
    // Deleted before its turn, or already imported.
    if (!row?.sourceStorageKey || row.status !== "IMPORTING") return;
    const storageKey = row.sourceStorageKey;
    try {
      const bible = importBible((await this.storage.get(storageKey)).toString("utf-8"));
      const verses = bible.books.flatMap((book) =>
        book.chapters.flatMap((chapter) =>
          chapter.verses.map((verse) => ({ bibleId: row.id, book: book.number, chapter: chapter.number, verse: verse.number, endVerse: verse.endNumber ?? null, text: verse.text })),
        ),
      );
      if (verses.length === 0) throw new BibleImportError("The file has no verses");
      const books: ImportedBibleBook[] = bible.books.map((book) => ({
        number: book.number,
        name: book.name,
        ...(book.osisId ? { osisId: book.osisId } : {}),
        chapters: book.chapters.reduce((last, chapter) => Math.max(last, chapter.number), 0),
      }));
      const { abbreviation, language, copyright, sourceFormat } = bible.metadata;
      await this.prisma.client.bibleVerse.deleteMany({ where: { bibleId: row.id } });
      for (let at = 0; at < verses.length; at += VERSES_PER_WRITE) {
        // A verse number given twice keeps the first.
        await this.prisma.client.bibleVerse.createMany({ data: verses.slice(at, at + VERSES_PER_WRITE), skipDuplicates: true });
      }
      await this.prisma.client.bible.update({
        where: { id: row.id },
        data: {
          status: "READY",
          error: null,
          sourceStorageKey: null,
          ...(bible.name ? { name: bible.name.slice(0, 200) } : {}),
          abbreviation: abbreviation?.slice(0, 20) ?? null,
          language: language ?? null,
          copyright: copyright ?? null,
          sourceFormat: sourceFormat ?? null,
          books: books as object[],
          verseCount: verses.length,
        },
      });
      this.logger.log(`Imported ${bible.name} (${sourceFormat}, ${verses.length} verses)`);
    } catch (err) {
      const message = err instanceof BibleImportError ? err.message : "The file couldn't be imported";
      if (!(err instanceof BibleImportError)) this.logger.error(`Importing Bible ${row.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.prisma.client.bibleVerse.deleteMany({ where: { bibleId: row.id } });
      await this.prisma.client.bible.updateMany({ where: { id: row.id }, data: { status: "FAILED", error: message.slice(0, 500), sourceStorageKey: null } });
    }
    await this.storage.deleteUnreferenced([storageKey]);
  }
}
