import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { confidentMatch } from "@oneverse/core";
import type { Job, Queue } from "bullmq";
import { JOB_WORKER_OPTIONS, SONG_INFO_QUEUE } from "../jobs/jobs.constants.js";
import { MetadataService } from "../metadata/metadata.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SongVersionsService } from "./song-versions.service.js";

export interface SongInfoJobData {
  songVersionId: string;
  /** Who imported it: the song's history credits them with what's filled. */
  authorUserId: string | null;
}

/** Puts imported songs on the song-info queue (issue #352); the Worker looks them up. */
@Injectable()
export class SongInfoService {
  private readonly logger = new Logger(SongInfoService.name);

  constructor(@InjectQueue(SONG_INFO_QUEUE) private readonly queue: Queue<SongInfoJobData>) {}

  /** Never throws: the import is done either way. Once per song while it's waiting. */
  async fill(songVersionId: string, authorUserId: string | null): Promise<void> {
    await this.queue
      .add("fill", { songVersionId, authorUserId }, { jobId: `fill-${songVersionId}`, removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } })
      .catch((err: Error) => this.logger.warn(`Song info lookup not queued: ${err.message}`));
  }
}

export type SongInfoOutcome =
  | { outcome: "filled"; fields: string[]; match: string }
  | { outcome: "linked-already" | "no-artist" | "no-close-match" | "nothing-to-fill" | "gone" | "providers-unavailable"; match?: string };

/**
 * An imported song looked up at the metadata providers (issue #352), the
 * way Auto detect does, without anyone to choose: only a match with the
 * same title and artist is taken, and only what the song doesn't have is
 * filled. A song already linked to song info is left alone. One at a time:
 * the providers limit how fast they're asked (MusicBrainz through
 * `sharedTurn()`).
 */
@Processor(SONG_INFO_QUEUE, { ...JOB_WORKER_OPTIONS, concurrency: 1 })
export class SongInfoProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metadata: MetadataService,
    private readonly songs: SongVersionsService,
  ) {
    super();
  }

  async process(job: Job<SongInfoJobData>): Promise<SongInfoOutcome> {
    const { songVersionId, authorUserId } = job.data;
    const linked = await this.prisma.client.songVersionIdentifier.findFirst({ where: { songVersionId, type: "METADATA_MATCH" }, select: { id: true } });
    if (linked) return { outcome: "linked-already" };
    const song = await this.prisma.client.songVersion.findUnique({ where: { id: songVersionId }, select: { id: true } });
    if (!song) return { outcome: "gone" };
    const current = await this.songs.songInfoOf(songVersionId);
    const artist = current.artists[0];
    if (!artist) return { outcome: "no-artist" };
    let matches;
    try {
      ({ matches } = await this.metadata.search(current.title, artist));
    } catch (err) {
      // No provider on, or none answering: nothing to fill this time.
      if (err instanceof ServiceUnavailableException) return { outcome: "providers-unavailable" };
      throw err;
    }
    const chosen = confidentMatch(matches, current.title, artist);
    if (!chosen) return { outcome: "no-close-match" };
    // Looked up again from its sources, as a chosen match always is: the tempo and writers come with it.
    const match = await this.metadata.lookup(chosen.sources);
    const label = `${match.title} · ${match.artist ?? ""}`;
    const fields = await this.songs.fillFromMatch(songVersionId, match, authorUserId);
    await this.songs.saveMetadataLink(songVersionId, match, { artwork: !current.hasImage });
    return fields.length ? { outcome: "filled", fields, match: label } : { outcome: "nothing-to-fill", match: label };
  }
}
