import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { UnrecoverableError, type Job, type Queue } from "bullmq";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JOB_WORKER_OPTIONS, WAVEFORMS_QUEUE } from "../jobs/jobs.constants.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { FfmpegMissingError, measureWaveform } from "../recordings/ffmpeg.js";
import { StorageService } from "../storage/storage.service.js";

const SWEEP = "sweep";
/** How often the files without one are looked for: those stored before (the backfill), or where no one asked. */
const SWEEP_EVERY_MS = 5 * 60 * 1000;
/** How long one sweep goes on before leaving the rest to the next. */
const SWEEP_FOR_MS = 4 * 60 * 1000;
/** Files looked up at a time. */
const BATCH = 10;

/**
 * Asks for the waveforms of files just stored (issue #388): a sweep a
 * moment from now. One waits at most; a sweep going on finds them too.
 */
export async function waveformsSoon(queue: Queue): Promise<void> {
  await queue.add(SWEEP, {}, { jobId: "waveforms-soon", delay: 1000, removeOnComplete: true, removeOnFail: true }).catch(() => undefined);
}

/**
 * Audio files' waveforms (issue #388): each stored object's worked out
 * once, by ffmpeg, and kept (AudioWaveform). A sweep goes through the audio
 * files without one - a recorded take or an upload being made Opus waits
 * for its final file - newest first, until none are left or its time is up.
 * The files from before are done this way too, a few minutes at a time.
 */
@Processor(WAVEFORMS_QUEUE, { ...JOB_WORKER_OPTIONS, lockDuration: 120_000 })
export class WaveformsProcessor extends WorkerHost {
  private readonly logger = new Logger(WaveformsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ measured: number; unreadable: number; left: boolean }> {
    const until = Date.now() + SWEEP_FOR_MS;
    let measured = 0;
    let unreadable = 0;
    // Tried once a sweep: one that fails without being unreadable (storage unreachable) waits for the next.
    const tried = new Set<string>();
    while (Date.now() < until) {
      const files = await this.prisma.client.$queryRaw<{ storageKey: string; storedInOrganizationId: string | null }[]>`
        SELECT DISTINCT ON (a."storageKey") a."storageKey", a."storedInOrganizationId"
        FROM "Attachment" a
        WHERE a."type" = 'AUDIO' AND a."processing" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "AudioWaveform" w WHERE w."storageKey" = a."storageKey")
        ORDER BY a."storageKey", a."createdAt" DESC
        LIMIT ${BATCH + tried.size}`;
      const todo = files.filter((file) => !tried.has(file.storageKey)).slice(0, BATCH);
      if (todo.length === 0) return { measured, unreadable, left: false };
      for (const file of todo) {
        tried.add(file.storageKey);
        const outcome = await this.measure(file.storageKey, file.storedInOrganizationId);
        if (outcome === "measured") measured++;
        else if (outcome === "unreadable") unreadable++;
      }
    }
    if (measured || unreadable) this.logger.log(`Waveforms: ${measured} measured, ${unreadable} unreadable; more next time`);
    return { measured, unreadable, left: true };
  }

  /** One stored file's waveform, kept; an empty one when ffmpeg can't read it, so it isn't tried again. */
  private async measure(storageKey: string, location: string | null): Promise<"measured" | "unreadable" | "skipped"> {
    const dir = await mkdtemp(path.join(tmpdir(), "songverse-waveform-"));
    try {
      let body: Buffer;
      try {
        body = await this.storage.get(storageKey, location);
      } catch (error) {
        this.logger.warn(`Waveform of ${storageKey}: couldn't fetch it (${error instanceof Error ? error.message : String(error)})`);
        return "skipped";
      }
      const file = path.join(dir, "audio");
      await writeFile(file, body);
      try {
        const waveform = await measureWaveform(file);
        await this.keep(storageKey, { rate: waveform.rate, seconds: waveform.seconds, loudest: waveform.loudest, peaks: waveform.peaks });
        return "measured";
      } catch (error) {
        // Without ffmpeg, nothing can be measured: the next sweep tries again (Admin says it's missing).
        if (error instanceof FfmpegMissingError) throw new UnrecoverableError(error.message);
        this.logger.warn(`Waveform of ${storageKey}: unreadable (${error instanceof Error ? error.message : String(error)})`);
        await this.keep(storageKey, { rate: 0, seconds: 0, loudest: 0, peaks: new Uint8Array(0) });
        return "unreadable";
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async keep(storageKey: string, data: { rate: number; seconds: number; loudest: number; peaks: Uint8Array }) {
    const row = { ...data, peaks: Buffer.from(data.peaks) };
    await this.prisma.client.audioWaveform.upsert({ where: { storageKey }, create: { storageKey, ...row }, update: row });
  }
}

/** Registers the sweep; upsertJobScheduler is idempotent across the API, the Worker and restarts. */
@Injectable()
export class WaveformsScheduler implements OnModuleInit {
  constructor(@InjectQueue(WAVEFORMS_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(SWEEP, { every: SWEEP_EVERY_MS }, { name: SWEEP, opts: { removeOnComplete: 50, removeOnFail: 50 } });
  }
}
