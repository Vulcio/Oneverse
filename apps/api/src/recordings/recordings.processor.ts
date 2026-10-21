import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Prisma } from "@oneverse/db";
import { UnrecoverableError, type Job } from "bullmq";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JOB_WORKER_OPTIONS, RECORDINGS_QUEUE } from "../jobs/jobs.constants.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { encodeUpload, FfmpegMissingError, isLosslessCodec, losslessOriginal, MAX_UPLOAD_BITRATE, probeAudio, processTake } from "./ffmpeg.js";
import { writeFile } from "node:fs/promises";

export interface ProcessTakeJob {
  attachmentId: string;
  /** Shown in Admin > Background jobs. */
  filename: string;
  level: boolean;
  noise: boolean;
  /** RNNoise, for a voice (issue #132). */
  voice?: boolean;
  /** Its first beat (s): the count-in before it is the room's noise. */
  quietFor?: number | null;
}

export interface ShrinkUploadJob {
  attachmentId: string;
  /** Shown in Admin > Background jobs. */
  filename: string;
  /** Its uploader may keep a lossless original (a role, or a global admin): kept as FLAC beside the Opus copy. */
  keepOriginal?: boolean;
}

/**
 * A recorded take, turned from the browser's WAV into Opus (issue #127) -
 * or any audio file cleaned up afterwards (issue #132):
 * about an eighth of the size, its trailing silence trimmed, its level
 * evened out and its noise reduced if asked. The result replaces the WAV
 * as a new file (a new id, so offline copies and caches fetch it again),
 * with everything else about it the same.
 */
@Processor(RECORDINGS_QUEUE, JOB_WORKER_OPTIONS)
export class RecordingsProcessor extends WorkerHost {
  private readonly logger = new Logger(RecordingsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<ProcessTakeJob | ShrinkUploadJob>): Promise<{ attachmentId: string; bytes: number } | { skipped: string }> {
    if (job.name === "shrink-upload") return this.shrink(job as Job<ShrinkUploadJob>);
    return this.processTake(job as Job<ProcessTakeJob>);
  }

  /**
   * An uploaded audio file above 320 kbps - its size over its length - made
   * Opus (issue #182): a WAV, FLAC or AIFF is several times the size of what
   * anyone hears in it. A lossless one keeps its original as FLAC beside it,
   * when its uploader may. Below that, it stays as uploaded. If it can't be
   * read or encoded, it stays as uploaded too: nothing's wrong with it.
   */
  private async shrink(job: Job<ShrinkUploadJob>): Promise<{ attachmentId: string; bytes: number } | { skipped: string }> {
    const file = await this.prisma.client.attachment.findUnique({ where: { id: job.data.attachmentId } });
    if (!file || file.type !== "AUDIO" || file.processing === "FAILED") return { skipped: "gone" };
    const dir = await mkdtemp(path.join(tmpdir(), "songverse-upload-"));
    const keep = async (reason: string) => {
      await this.prisma.client.attachment.updateMany({ where: { id: file.id, processing: "PENDING" }, data: { processing: null } });
      return { skipped: reason };
    };
    try {
      const body = await this.storage.get(file.storageKey);
      await writeFile(path.join(dir, "probe"), body);
      const probe = await probeAudio(path.join(dir, "probe"));
      if (!probe) return keep("its length can't be read");
      const bitrate = (body.length * 8) / probe.seconds;
      if (bitrate <= MAX_UPLOAD_BITRATE) return keep(`${Math.round(bitrate / 1000)} kbps: kept as uploaded`);
      const opus = await encodeUpload(body, dir, probe.channels);
      const original = job.data.keepOriginal && isLosslessCodec(probe.codec) ? await losslessOriginal(body, dir, probe.codec) : null;
      const { hash, sizeBytes } = await this.storage.put(opus, "audio/ogg");
      const kept = original ? await this.storage.put(original, "audio/flac") : null;
      // As it is now (its details may have changed while it was encoded).
      const current = await this.prisma.client.attachment.findUnique({ where: { id: file.id } });
      if (!current || current.storageKey !== file.storageKey) {
        await this.storage.deleteUnreferenced([hash, ...(kept ? [kept.hash] : [])]);
        return { skipped: "changed while it was encoded" };
      }
      // Everything about it but its id and file, the same: a new id, so offline copies and caches fetch it again.
      const rest: Partial<typeof current> = { ...current };
      delete rest.id;
      const [made] = await this.prisma.client.$transaction([
        this.prisma.client.attachment.create({
          data: { ...(rest as Omit<typeof current, "id">), cuePoints: current.cuePoints ?? Prisma.DbNull, filename: current.filename.replace(/\.[a-z0-9]{1,5}$/i, "") + ".opus", mimeType: "audio/ogg", storageKey: hash, sizeBytes, processing: null, ...(kept ? { originalStorageKey: kept.hash, originalMimeType: "audio/flac", originalSizeBytes: kept.sizeBytes } : {}) },
        }),
        this.prisma.client.attachment.delete({ where: { id: file.id } }),
      ]);
      await this.storage.deleteUnreferenced([file.storageKey]);
      this.logger.log(`Made ${file.filename} Opus (${Math.round(bitrate / 1000)} kbps): ${body.length} to ${sizeBytes} bytes${kept ? `, its original kept as FLAC (${kept.sizeBytes} bytes)` : ""}`);
      return { attachmentId: made.id, bytes: sizeBytes };
    } catch (error) {
      if (error instanceof FfmpegMissingError || job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        this.logger.warn(`Kept ${file.filename} as uploaded: ${error instanceof Error ? error.message : String(error)}`);
        return keep("couldn't be encoded");
      }
      throw error;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async processTake(job: Job<ProcessTakeJob>): Promise<{ attachmentId: string; bytes: number } | { skipped: string }> {
    const take = await this.prisma.client.attachment.findUnique({ where: { id: job.data.attachmentId } });
    if (!take || take.processing !== "PENDING") return { skipped: "gone or already done" };
    const dir = await mkdtemp(path.join(tmpdir(), "songverse-take-"));
    try {
      const opus = await processTake(await this.storage.get(take.storageKey), dir, { level: job.data.level, noise: job.data.noise, voice: job.data.voice, quietFor: job.data.quietFor });
      const { hash, sizeBytes } = await this.storage.put(opus, "audio/ogg");
      // Everything about it but its id and file, the same.
      const rest: Partial<typeof take> = { ...take };
      delete rest.id;
      const [processed] = await this.prisma.client.$transaction([
        this.prisma.client.attachment.create({
          data: { ...(rest as Omit<typeof take, "id">), cuePoints: take.cuePoints ?? Prisma.DbNull, filename: take.filename.replace(/\.[a-z0-9]{1,5}$/i, "") + ".opus", mimeType: "audio/ogg", storageKey: hash, sizeBytes, processing: null },
        }),
        this.prisma.client.attachment.delete({ where: { id: take.id } }),
      ]);
      await this.storage.deleteUnreferenced([take.storageKey]);
      this.logger.log(`Processed ${take.filename}: ${take.sizeBytes ?? 0} to ${sizeBytes} bytes`);
      return { attachmentId: processed.id, bytes: sizeBytes };
    } catch (error) {
      // Its last try (or no ffmpeg to try with): it stays as recorded, and says so.
      const missing = error instanceof FfmpegMissingError;
      if (missing || job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await this.prisma.client.attachment.updateMany({ where: { id: take.id, processing: "PENDING" }, data: { processing: "FAILED" } });
      }
      // Without ffmpeg, trying again won't help.
      throw missing ? new UnrecoverableError(error.message) : error;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
