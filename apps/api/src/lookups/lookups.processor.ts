import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { ArtistsService } from "../artists/artists.service.js";
import { ArtworkService } from "../artwork/artwork.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { backfillLyrics } from "../song-versions/lyrics-backfill.js";
import { backfillRepeats } from "../song-versions/repeats-backfill.js";
import { BACKFILLS_QUEUE, JOB_WORKER_OPTIONS, LOOKUPS_QUEUE } from "../jobs/jobs.constants.js";

export type LookupJob =
  | { name: "artwork"; data: { songVersionId: string } }
  | { name: "artist"; data: { name: string } }
  | { name: "artwork-backfill"; data: Record<string, never> }
  | { name: "artist-backfill"; data: Record<string, never> }
  | { name: "lyrics-backfill"; data: Record<string, never> }
  | { name: "repeats-backfill"; data: { apply?: boolean } };

/**
 * The lookups queue (issue #92): a new song's artwork, a new artist's
 * picture and bio - one at a time, as the providers limit how fast they're
 * asked. The admin's backfills have a queue of their own (BackfillsProcessor).
 */
@Processor(LOOKUPS_QUEUE, { ...JOB_WORKER_OPTIONS, concurrency: 1 })
export class LookupsProcessor extends WorkerHost {
  private readonly logger = new Logger(LookupsProcessor.name);

  constructor(
    private readonly artwork: ArtworkService,
    private readonly artists: ArtistsService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name as LookupJob["name"]) {
      case "artwork":
        return { outcome: await this.artwork.autoFind((job.data as { songVersionId: string }).songVersionId) };
      case "artist":
        return this.artists.lookUpNamed((job.data as { name: string }).name);
      default:
        this.logger.warn(`Unknown lookup job ${job.name}`);
        return null;
    }
  }
}

/**
 * The admin's backfills (issues #85, #86), one at a time, on a queue of
 * their own (issue #93): one works through dozens of songs or artists, and
 * a new song's lookups mustn't wait for it.
 */
@Processor(BACKFILLS_QUEUE, { ...JOB_WORKER_OPTIONS, concurrency: 1 })
export class BackfillsProcessor extends WorkerHost {
  private readonly logger = new Logger(BackfillsProcessor.name);

  constructor(
    private readonly artwork: ArtworkService,
    private readonly artists: ArtistsService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case "lyrics-backfill":
        return backfillLyrics(this.prisma);
      case "repeats-backfill":
        return backfillRepeats(this.prisma, !!(job.data as { apply?: boolean }).apply);
      case "artwork-backfill":
        return this.artwork.backfill();
      case "artist-backfill":
        return this.artists.backfill();
      default:
        this.logger.warn(`Unknown backfill job ${job.name}`);
        return null;
    }
  }
}
