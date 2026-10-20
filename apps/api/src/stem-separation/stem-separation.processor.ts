import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@songverse/db";
import { UnrecoverableError, type Job, type Queue } from "bullmq";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { JOB_WORKER_OPTIONS, STEM_SEPARATION_QUEUE } from "../jobs/jobs.constants.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { encodeStem, FfmpegMissingError } from "../recordings/ffmpeg.js";
import { StorageQuotaService } from "../storage/storage-quota.service.js";
import { StorageService } from "../storage/storage.service.js";
import { readSongDocument, type CuePoint } from "@songverse/core";
import en from "@songverse/core/i18n/locales/en";
import fr from "@songverse/core/i18n/locales/fr";
import { detailsWithAnalysis } from "./analysis.js";
import { DemucsError, downloadDemucsFile, getDemucsJob, submitDemucsJob, type DemucsAnalysis, type DemucsFile, type DemucsJob } from "./demucs-client.js";
import { getEffectiveStemSeparationSettings } from "./stem-separation-settings.js";
import { partOfStem, twoStemsOf } from "./stem-parts.js";

export interface SubmitSeparationJob {
  separationId: string;
  /** Where its webhooks go (the API's address, which the Worker doesn't know), and the secret they're signed with. */
  callbackUrl: string | null;
  /** Shown in Admin > Background jobs. */
  filename?: string;
}
export interface SyncSeparationJob {
  separationId: string;
}

const POLL_SCHEDULER_ID = "poll-stem-separations";
const POLL_EVERY_MS = 2 * 60 * 1000;
/** What the stems of a separation were named before they said their parts (issue #175). */
export const SEPARATED_MULTITRACK_NAME = "Separated (Demucs)";
const NAMES = { en: en.separation.multitrackName, fr: fr.separation.multitrackName };

/** A separation's multitrack, named by its parts in the language of whoever asked for it: "Separated (6 parts)". */
export function separatedName(parts: string, locale: string | null | undefined): string {
  return (NAMES[locale as keyof typeof NAMES] ?? NAMES.en).replace("{{parts}}", parts);
}

/** Whether a multitrack still has the name its separation gave it, in any language - not one someone chose. */
export function isSeparatedName(name: string): boolean {
  if (name === SEPARATED_MULTITRACK_NAME) return true;
  return Object.values(NAMES).some((pattern) => {
    const [before, after] = pattern.split("{{parts}}") as [string, string];
    return name.length > before.length + after.length && name.startsWith(before) && name.endsWith(after) && /^\d+$/.test(name.slice(before.length, name.length - after.length));
  });
}

/**
 * Stem separation in the Worker (issue #63). `submit` sends the recording
 * to the Demucs API; `sync` asks where its job is and brings in what's
 * ready - the fast pass's stems as a new multitrack, then the HQ pass's in
 * their place - called by the API when a signed webhook comes, and every
 * two minutes for every separation not done (webhooks can be lost).
 */
@Processor(STEM_SEPARATION_QUEUE, JOB_WORKER_OPTIONS)
export class StemSeparationProcessor extends WorkerHost {
  private readonly logger = new Logger(StemSeparationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
    @InjectQueue(STEM_SEPARATION_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === POLL_SCHEDULER_ID) return this.pollAll();
    if (job.name === "submit") return this.submit(job as Job<SubmitSeparationJob>);
    if (job.name === "sync") return this.sync((job.data as SyncSeparationJob).separationId);
    return { skipped: `unknown job ${job.name}` };
  }

  private async fail(separationId: string, error: string) {
    await this.prisma.client.stemSeparation.update({ where: { id: separationId }, data: { status: "FAILED", error: error.slice(0, 500) } });
  }

  private async submit(job: Job<SubmitSeparationJob>) {
    const separation = await this.prisma.client.stemSeparation.findUnique({ where: { id: job.data.separationId } });
    if (!separation || separation.status !== "QUEUED") return { skipped: "gone or already sent" };
    const source = await this.prisma.client.attachment.findUnique({ where: { id: separation.sourceAttachmentId } });
    if (!source) return this.fail(separation.id, "The recording was deleted before it could be sent");
    const settings = await getEffectiveStemSeparationSettings();
    try {
      const parts = separation.parts;
      const fastModel = parts === "6" ? "htdemucs_6s" : settings.fastModel;
      const hqModel = separation.hqRequested ? settings.hqModel : null;
      // Its lossless original when one was kept (issue #182): separated from the best copy there is.
      const submitted = await submitDemucsJob(settings, await this.storage.get(source.originalStorageKey ?? source.storageKey), source.originalStorageKey ? source.filename.replace(/\.[a-z0-9]{1,5}$/i, ".flac") : source.filename, source.originalStorageKey ? (source.originalMimeType ?? "audio/flac") : source.mimeType, {
        model: fastModel,
        twoStems: twoStemsOf(parts),
        hq: hqModel ? { model: hqModel } : undefined,
        callbackUrl: job.data.callbackUrl ?? undefined,
        callbackSecret: settings.callbackSecret ?? undefined,
      });
      // A server started afresh can number its jobs again: an older separation holding the same ID lost its job with it.
      await this.prisma.client.$transaction([
        this.prisma.client.stemSeparation.updateMany({
          where: { jobId: submitted.id, id: { not: separation.id } },
          data: { jobId: null, status: "FAILED", error: "The separation server forgot this job" },
        }),
        // The models it's sent with (issue #175): Admin's can change later.
        this.prisma.client.stemSeparation.update({ where: { id: separation.id }, data: { status: "SUBMITTED", jobId: submitted.id, error: null, fastModel, hqModel, sourceFilename: source.filename } }),
      ]);
      this.logger.log(`Sent ${source.filename} to the Demucs API: job ${submitted.id}`);
      return { jobId: submitted.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A refusal (a bad model, too large) won't change; an unreachable API might.
      const final = error instanceof DemucsError && error.status !== undefined && error.status < 500;
      if (final || job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await this.fail(separation.id, message);
      throw final ? new UnrecoverableError(message) : error;
    }
  }

  private async pollAll() {
    // Not set up (any more): nothing can be asked, so nothing's looked at - they carry on when it is again.
    const settings = await getEffectiveStemSeparationSettings();
    if (!settings.apiUrl || !settings.apiKey) return { polled: 0 };
    const open = await this.prisma.client.stemSeparation.findMany({ where: { status: { in: ["SUBMITTED", "FAST_READY"] }, jobId: { not: null } }, select: { id: true } });
    for (const { id } of open) await this.queue.add("sync", { separationId: id }, { jobId: `sync-${id}-${Math.floor(Date.now() / POLL_EVERY_MS)}`, removeOnComplete: { count: 200 }, removeOnFail: { count: 200 } });
    return { polled: open.length };
  }

  private async sync(separationId: string) {
    const separation = await this.prisma.client.stemSeparation.findUnique({ where: { id: separationId } });
    if (!separation?.jobId || (separation.status !== "SUBMITTED" && separation.status !== "FAST_READY")) return { skipped: "nothing to bring in" };
    const settings = await getEffectiveStemSeparationSettings();
    let job: DemucsJob;
    try {
      job = await getDemucsJob(settings, separation.jobId);
    } catch (error) {
      // Gone from the API (deleted there): nothing more will come.
      if (error instanceof DemucsError && error.status === 404) return this.fail(separation.id, "The job is no longer at the Demucs API");
      throw error;
    }
    if (separation.status === "SUBMITTED") {
      if (job.fast?.status === "completed" && job.fast.files?.length) {
        await this.importFast(separation.id, job.fast.files, job.analysis);
      } else if (job.status === "failed" || job.fast?.status === "failed") {
        return this.fail(separation.id, job.error ? `Demucs: ${job.error}` : "The separation failed at the Demucs API");
      } else {
        return { waiting: job.status };
      }
    }
    const now = await this.prisma.client.stemSeparation.findUnique({ where: { id: separation.id } });
    if (now?.status !== "FAST_READY") return { status: now?.status };
    if (job.hq?.status === "completed" && job.hq.files?.length) return this.importHq(separation.id, job.hq.files);
    // The HQ pass failed: the fast stems stay, and it's done.
    if (job.status === "fast_completed" || job.hq?.status === "failed") {
      await this.prisma.client.stemSeparation.update({ where: { id: separation.id }, data: { status: "COMPLETED", error: job.error ? `The high-quality pass failed (${job.error}): the first stems stay` : "The high-quality pass failed: the first stems stay" } });
      return { hq: "failed" };
    }
    return { waiting: job.status };
  }

  /** Each file downloaded, made Opus (as it is, if ffmpeg isn't here), with its part. */
  private async fetchStems(files: DemucsFile[], parts: string) {
    const settings = await getEffectiveStemSeparationSettings();
    const dir = await mkdtemp(path.join(tmpdir(), "songverse-stems-"));
    try {
      const out: { part: ReturnType<typeof partOfStem>; body: Buffer; mimeType: string; extension: string }[] = [];
      for (const file of files) {
        const wav = await downloadDemucsFile(settings, file);
        let body = wav;
        let mimeType = "audio/wav";
        let extension = "wav";
        try {
          body = await encodeStem(wav, dir);
          mimeType = "audio/ogg";
          extension = "opus";
        } catch (error) {
          if (!(error instanceof FfmpegMissingError)) throw error;
        }
        out.push({ part: partOfStem(file.name, parts), body, mimeType, extension });
      }
      return out;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * The fast pass's stems: a new multitrack beside the recording, timed as
   * it is - or, where the recording has no key, tempo, time signature, first
   * beat or sections, as the server's analysis found them (issue #175),
   * marked detected. Replacing an earlier separation's stems, it takes over
   * that multitrack's sections, who sees it, its set and a name someone gave
   * it; the recordings people made into it move over, its stems go.
   */
  private async importFast(separationId: string, files: DemucsFile[], analysis: DemucsAnalysis | null | undefined) {
    const separation = await this.prisma.client.stemSeparation.findUniqueOrThrow({
      where: { id: separationId },
      include: { requestedBy: { select: { locale: true } }, songVersion: { select: { documentJson: true } } },
    });
    const source = await this.prisma.client.attachment.findUnique({ where: { id: separation.sourceAttachmentId } });
    const stems = await this.fetchStems(files, separation.parts);
    const bytes = stems.reduce((sum, stem) => sum + stem.body.length, 0);
    if (separation.requestedByUserId) {
      try {
        // The song's team's pool for a team's song (issue #160), else the requester's own.
        await this.quota.assertCanStore(separation.requestedByUserId, bytes, separation.songVersionId);
      } catch {
        return this.fail(separation.id, "The stems would go over the storage limit");
      }
    }
    // The earlier separation's multitrack, if this one replaces it and it's still there.
    const earlier = separation.replacesMultitrackId
      ? await this.prisma.client.attachment.findMany({ where: { songVersionId: separation.songVersionId, multitrackId: separation.replacesMultitrackId } })
      : [];
    const earlierStems = earlier.filter((file) => file.origin === "SEPARATED");
    const earlierFirst = earlierStems[0] ?? earlier[0];
    const multitrackId = `sep-${separation.id}`;
    const name = separatedName(separation.parts, separation.requestedBy?.locale);
    const keptName = earlierFirst?.multitrackName && !isSeparatedName(earlierFirst.multitrackName) ? earlierFirst.multitrackName : null;
    const base = (source?.filename ?? separation.sourceFilename ?? "Recording").replace(/\.[a-z0-9]{1,5}$/i, "");
    let song = null;
    try {
      song = readSongDocument(separation.songVersion.documentJson);
    } catch {
      // A song without a chart: no sections to place.
    }
    const earlierCues = (earlierFirst?.cuePoints as CuePoint[] | null) ?? null;
    const details = detailsWithAnalysis(
      {
        recordingKey: source?.recordingKey ?? null,
        recordingTempo: source?.recordingTempo ?? null,
        recordingTimeSignature: source?.recordingTimeSignature ?? null,
        recordingFirstBeat: source?.recordingFirstBeat ?? null,
        recordingFreeIntro: source?.recordingFreeIntro ?? false,
        recordingBeats: source?.recordingBeats ?? [],
        recordingDownbeats: source?.recordingDownbeats ?? [],
        // The recording's sections, else those placed on the stems this replaces.
        cuePoints: (source?.cuePoints as CuePoint[] | null) ?? earlierCues,
      },
      analysis,
      song,
    );
    // Seen by whoever sees the recording it came from (or the stems it replaces); the requester's alone if both are gone.
    const audience = source ?? earlierFirst;
    const stored = [];
    for (const stem of stems) stored.push({ ...stem, ...(await this.storage.put(stem.body, stem.mimeType)) });
    await this.prisma.client.$transaction([
      ...stored.map((stem) =>
        this.prisma.client.attachment.create({
          data: {
            songVersionId: separation.songVersionId,
            type: "AUDIO",
            filename: `${base} - ${stem.part.label}.${stem.extension}`,
            mimeType: stem.mimeType,
            storageKey: stem.hash,
            sizeBytes: stem.sizeBytes,
            stemPart: stem.part.stemPart,
            partName: stem.part.partName,
            uploadedByUserId: separation.requestedByUserId,
            visibility: audience?.visibility ?? "PRIVATE",
            visibleToTeamId: audience?.visibleToTeamId ?? null,
            multitrackId,
            multitrackName: keptName ?? name,
            multitrackSetlistId: earlierFirst?.multitrackSetlistId ?? null,
            // The same audio: its key, tempo, time signature, first beat and sections.
            recordingKey: details.recordingKey,
            recordingTempo: details.recordingTempo,
            recordingTimeSignature: details.recordingTimeSignature,
            recordingFirstBeat: details.recordingFirstBeat,
            recordingFreeIntro: details.recordingFreeIntro,
            recordingBeats: details.recordingBeats,
            recordingDownbeats: details.recordingDownbeats,
            cuePoints: details.cuePoints?.length ? (details.cuePoints as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
            detected: details.detected,
            origin: "SEPARATED",
            // Kept as made (issue #145), until unlocked.
            locked: true,
          },
        }),
      ),
      // The recordings made into the stems this replaces, moved over to these.
      this.prisma.client.attachment.updateMany({
        where: { id: { in: earlier.filter((file) => file.origin !== "SEPARATED").map((file) => file.id) } },
        data: { multitrackId, multitrackName: keptName ?? name },
      }),
      this.prisma.client.attachment.deleteMany({ where: { id: { in: earlierStems.map((file) => file.id) } } }),
      this.prisma.client.stemSeparation.update({
        where: { id: separation.id },
        data: { multitrackId, status: separation.hqRequested ? "FAST_READY" : "COMPLETED", error: null },
      }),
    ]);
    if (earlierStems.length) await this.storage.deleteUnreferenced(earlierStems.map((file) => file.storageKey));
    this.logger.log(`Separated ${base}: ${stems.length} stems (${bytes} bytes)${earlierStems.length ? `, replacing ${earlierStems.length}` : ""}`);
    return { imported: stems.length, replaced: earlierStems.length };
  }

  /**
   * The HQ pass's stems, in place of the fast ones: each part a new file
   * (so devices keeping it offline fetch it again), with everything the
   * fast one had by then - its sections, name, lock, who sees it.
   */
  private async importHq(separationId: string, files: DemucsFile[]) {
    const separation = await this.prisma.client.stemSeparation.findUniqueOrThrow({ where: { id: separationId } });
    // Only its own stems (issue #174): never a recording someone made into this multitrack.
    const current = await this.prisma.client.attachment.findMany({ where: { songVersionId: separation.songVersionId, multitrackId: separation.multitrackId ?? "-", origin: "SEPARATED" } });
    const stems = await this.fetchStems(files, separation.parts);
    const replaced: string[] = [];
    for (const stem of stems) {
      const fast = current.find((file) => file.stemPart === stem.part.stemPart && (file.partName ?? null) === stem.part.partName && !replaced.includes(file.storageKey));
      // Deleted since: not brought back.
      if (!fast) continue;
      const { hash, sizeBytes } = await this.storage.put(stem.body, stem.mimeType);
      const rest: Partial<typeof fast> = { ...fast };
      delete rest.id;
      await this.prisma.client.$transaction([
        this.prisma.client.attachment.create({
          data: { ...(rest as Omit<typeof fast, "id">), cuePoints: fast.cuePoints ?? Prisma.DbNull, filename: fast.filename.replace(/\.[a-z0-9]{1,5}$/i, `.${stem.extension}`), mimeType: stem.mimeType, storageKey: hash, sizeBytes },
        }),
        this.prisma.client.attachment.delete({ where: { id: fast.id } }),
      ]);
      replaced.push(fast.storageKey);
    }
    await this.storage.deleteUnreferenced(replaced);
    await this.prisma.client.stemSeparation.update({ where: { id: separation.id }, data: { status: "COMPLETED", hqDone: true, error: null } });
    this.logger.log(`High-quality stems in: ${replaced.length} replaced`);
    return { replaced: replaced.length };
  }
}

/** The check every two minutes; upsertJobScheduler is idempotent, so every process registering it leaves one. */
@Injectable()
export class StemSeparationScheduler implements OnModuleInit {
  constructor(@InjectQueue(STEM_SEPARATION_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(POLL_SCHEDULER_ID, { every: POLL_EVERY_MS }, { name: POLL_SCHEDULER_ID });
  }
}
