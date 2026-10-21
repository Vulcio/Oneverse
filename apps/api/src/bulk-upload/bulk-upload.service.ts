import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { matchFilenamesToEntryCodes, type BulkUploadFileMatch } from "@oneverse/core";
import type { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service.js";
import { SongbooksService } from "../songbooks/songbooks.service.js";
import { StorageQuotaService } from "../storage/storage-quota.service.js";
import { StorageService } from "../storage/storage.service.js";
import { BULK_UPLOAD_QUEUE, type BulkUploadJobData } from "./bulk-upload.types.js";
import type { BulkUploadTypeValue } from "./dto/bulk-upload-commit.dto.js";

export interface BulkUploadCommitResult {
  queued: number;
  skipped: string[];
}

@Injectable()
export class BulkUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly songbooksService: SongbooksService,
    private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
    @InjectQueue(BULK_UPLOAD_QUEUE) private readonly queue: Queue<BulkUploadJobData>,
  ) {}

  async preview(songbookId: string, filenames: string[], type?: BulkUploadTypeValue): Promise<BulkUploadFileMatch[]> {
    const entryCodes = await this.entryCodesForNumberedSongbook(songbookId);
    return matchFilenamesToEntryCodes(filenames, entryCodes, type);
  }

  /**
   * Stores each matched file's bytes synchronously (fast - just a hash
   * and a write) and enqueues one small BullMQ job per file to do the
   * actual materialize/parse/link work in the background. Unmatched or
   * duplicate-matched files are reported back, never guessed at - see
   * the "review step is mandatory" rule in docs/songbooks-and-catalog.md
   * §7.
   */
  async commit(
    uploaderId: string,
    songbookId: string,
    type: BulkUploadTypeValue,
    files: Express.Multer.File[],
  ): Promise<BulkUploadCommitResult> {
    const entryCodes = await this.entryCodesForNumberedSongbook(songbookId);
    const matches = matchFilenamesToEntryCodes(
      files.map((file) => file.originalname),
      entryCodes,
      type,
    );
    const matchByFilename = new Map(matches.map((match) => [match.filename, match]));

    const skipped: string[] = [];
    const accepted: { file: Express.Multer.File; entryCode: string }[] = [];
    for (const file of files) {
      const match = matchByFilename.get(file.originalname);
      if (!match || match.status !== "MATCHED" || !match.entryCode) {
        skipped.push(file.originalname);
        continue;
      }
      accepted.push({ file, entryCode: match.entryCode });
    }

    // All-or-nothing against the storage limit, checked before anything is stored.
    await this.quota.assertCanStore(
      uploaderId,
      accepted.reduce((total, { file }) => total + file.size, 0),
    );

    let queued = 0;
    for (const { file, entryCode } of accepted) {
      const { hash, sizeBytes } = await this.storage.put(file.buffer, file.mimetype);
      await this.queue.add("process-file", {
        songbookId,
        entryCode,
        type,
        filename: file.originalname,
        mimeType: file.mimetype,
        storageKey: hash,
        sizeBytes,
        uploadedByUserId: uploaderId,
      } satisfies BulkUploadJobData);
      queued++;
    }
    return { queued, skipped };
  }

  private async entryCodesForNumberedSongbook(songbookId: string): Promise<string[]> {
    const songbook = await this.prisma.client.songbook.findUnique({
      where: { id: songbookId },
      select: { kind: true },
    });
    if (!songbook) throw new NotFoundException("Songbook not found");
    if (songbook.kind !== "NUMBERED") {
      throw new BadRequestException("Bulk upload matches files by number - only supported for NUMBERED songbooks");
    }
    return this.songbooksService.entryCodesFor(songbookId);
  }
}
