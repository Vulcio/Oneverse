import { Processor, WorkerHost } from "@nestjs/bullmq";
import { JOB_WORKER_OPTIONS } from "../jobs/jobs.constants.js";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service.js";
import { SongbooksService } from "../songbooks/songbooks.service.js";
import { SongInfoService } from "../song-versions/song-info.js";
import { SongVersionsService } from "../song-versions/song-versions.service.js";
import { StorageService } from "../storage/storage.service.js";
import { BULK_UPLOAD_QUEUE, type BulkUploadJobData } from "./bulk-upload.types.js";

/**
 * One job per file (see bulk-upload.types.ts for why the payload stays
 * small). Resolving the target SongVersion goes through
 * SongbooksService.ensureEntryForCode() - the exact same lazy-
 * materialization path the interactive "Start" button on a pending
 * catalog entry uses - so a bulk upload against a not-yet-started entry
 * is itself the "start", per docs/songbooks-and-catalog.md §7.
 */
@Processor(BULK_UPLOAD_QUEUE, JOB_WORKER_OPTIONS)
export class BulkUploadProcessor extends WorkerHost {
  private readonly logger = new Logger(BulkUploadProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly songbooksService: SongbooksService,
    private readonly songVersionsService: SongVersionsService,
    private readonly storage: StorageService,
    private readonly songInfo: SongInfoService,
  ) {
    super();
  }

  async process(job: Job<BulkUploadJobData>): Promise<void> {
    const { songbookId, entryCode, type, filename, mimeType, storageKey, sizeBytes, uploadedByUserId } = job.data;

    const target = await this.songbooksService.ensureEntryForCode(songbookId, entryCode);
    if (!target) {
      this.logger.warn(`Skipping ${filename}: no entry (existing or catalog-backed) for code ${entryCode}`);
      return;
    }

    if (type === "CHORDPRO") {
      const buffer = await this.storage.get(storageKey);
      await this.songVersionsService.importText(target.songVersionId, buffer.toString("utf-8"), "CHORDPRO", uploadedByUserId ?? null);
    }

    // Kept alongside the parsed content, not instead of it - this is the
    // original upload (an export is built from the document on demand),
    // and for PDF it's the only artifact at all.
    await this.prisma.client.attachment.create({
      data: {
        songVersionId: target.songVersionId,
        type,
        filename,
        mimeType,
        storageKey,
        sizeBytes,
        uploadedByUserId: uploadedByUserId ?? null,
      },
    });
    // What the song doesn't have yet, from the metadata providers (issue #352): a job of its own, one at a time.
    await this.songInfo.fill(target.songVersionId, uploadedByUserId ?? null);
  }
}
