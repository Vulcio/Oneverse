import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { Job, Queue } from "bullmq";
import type { LiveOp } from "@oneverse/core";
import { JOB_WORKER_OPTIONS, LIVE_SESSIONS_QUEUE } from "../jobs/jobs.constants.js";
import { redis } from "../jobs/redis.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { sessionKey } from "./set-sessions.js";

// A set run live (issue #247, docs/live-session.md): its row, from when it starts until it ends.

const END_SCHEDULER_ID = "end-gone-live-sessions";
const RECORD_SCHEDULER_ID = "record-live-sessions";
const HOUR_MS = 60 * 60 * 1000;
const RECORD_EVERY_MS = 60 * 1000;
/** How long a session's record is kept after it ends (decided in #247). */
export const LIVE_RECORD_DAYS = 90;
/**
 * Each change applied to a live session, waiting for the Worker to write it
 * to LiveSessionCommand: a change never waits on the database. Capped, so a
 * Worker that's down for long loses the oldest rather than filling Redis.
 */
export const RECORD_STREAM = "songverse:live:record";
const RECORD_STREAM_MAX = 200_000;
const RECORD_BATCH = 500;

/** One change, as it was applied. */
export interface LiveRecordEntry {
  sessionId: string;
  rev: number;
  epoch: number;
  at: number;
  userId: string | null;
  deviceId: string | null;
  origin: string;
  op: LiveOp;
}

/** `entry` added to the record's stream. */
export async function recordLiveOp(entry: LiveRecordEntry) {
  await redis().xadd(RECORD_STREAM, "MAXLEN", "~", String(RECORD_STREAM_MAX), "*", "entry", JSON.stringify(entry));
}

/** A new live session for the set, started by `userId`: any other still LIVE for it ended first (one per set). Its id and epoch. */
export async function startLiveSession(prisma: PrismaService, setId: string, userId: string | null): Promise<{ id: string; epoch: number }> {
  return prisma.client.$transaction(async (tx) => {
    await tx.liveSession.updateMany({ where: { setlistId: setId, status: "LIVE" }, data: { status: "ENDED", endedAt: new Date() } });
    return tx.liveSession.create({ data: { setlistId: setId, startedById: userId }, select: { id: true, epoch: true } });
  });
}

/** The live session ended (someone ended it, or it was gone). */
export async function endLiveSession(prisma: PrismaService, sessionId: string) {
  await prisma.client.liveSession.updateMany({ where: { id: sessionId, status: "LIVE" }, data: { status: "ENDED", endedAt: new Date() } });
}

/**
 * Every minute: the record's stream written to LiveSessionCommand (an entry
 * whose session has no row is dropped). Hourly: LIVE sessions whose state is gone from Redis (nobody changed it for
 * SESSION_TTL_S) or is another session's now, ended, and the sessions ended
 * more than LIVE_RECORD_DAYS ago deleted with their record.
 */
@Processor(LIVE_SESSIONS_QUEUE, JOB_WORKER_OPTIONS)
export class LiveSessionsProcessor extends WorkerHost {
  private readonly logger = new Logger(LiveSessionsProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === RECORD_SCHEDULER_ID) return { recorded: await this.writeRecord() };
    return { ended: await this.endGone(), deleted: await this.deleteOld() };
  }

  /** The stream's entries, written in batches and then taken off it. How many were written. */
  async writeRecord(): Promise<number> {
    let written = 0;
    for (;;) {
      const batch = await redis().xrange(RECORD_STREAM, "-", "+", "COUNT", RECORD_BATCH);
      if (batch.length === 0) return written;
      const entries = batch.flatMap(([, fields]) => {
        try {
          return [JSON.parse(fields[1] ?? "") as LiveRecordEntry];
        } catch {
          return [];
        }
      });
      const known = new Set(
        (await this.prisma.client.liveSession.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.sessionId))] } }, select: { id: true } })).map((row) => row.id),
      );
      const users = new Set(
        (await this.prisma.client.user.findMany({ where: { id: { in: [...new Set(entries.flatMap((e) => (e.userId ? [e.userId] : [])))] } }, select: { id: true } })).map((row) => row.id),
      );
      const { count } = await this.prisma.client.liveSessionCommand.createMany({
        data: entries
          .filter((e) => known.has(e.sessionId))
          .map((e) => ({ sessionId: e.sessionId, rev: e.rev, epoch: e.epoch, at: new Date(e.at), userId: e.userId && users.has(e.userId) ? e.userId : null, deviceId: e.deviceId, origin: e.origin, op: e.op as object })),
        skipDuplicates: true,
      });
      written += count;
      await redis().xdel(RECORD_STREAM, ...batch.map(([id]) => id));
      if (batch.length < RECORD_BATCH) return written;
    }
  }

  private async deleteOld(): Promise<number> {
    const before = new Date(Date.now() - LIVE_RECORD_DAYS * 24 * HOUR_MS);
    const { count } = await this.prisma.client.liveSession.deleteMany({ where: { status: "ENDED", endedAt: { lt: before } } });
    if (count > 0) this.logger.log(`Deleted ${count} live session(s) ended more than ${LIVE_RECORD_DAYS} days ago, with their record`);
    return count;
  }

  private async endGone(): Promise<number> {
    const live = await this.prisma.client.liveSession.findMany({ where: { status: "LIVE" }, select: { id: true, setlistId: true } });
    let ended = 0;
    for (const session of live) {
      const raw = await redis().get(sessionKey(session.setlistId));
      const kept = raw ? (JSON.parse(raw) as { sessionId?: string }).sessionId : undefined;
      if (kept === session.id) continue;
      await endLiveSession(this.prisma, session.id);
      ended++;
    }
    if (ended > 0) this.logger.log(`Ended ${ended} live session(s) nobody was running`);
    return ended;
  }
}

/** Registers the schedule; upsertJobScheduler is idempotent, so every process calling it leaves one. */
@Injectable()
export class LiveSessionsScheduler implements OnModuleInit {
  constructor(@InjectQueue(LIVE_SESSIONS_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(END_SCHEDULER_ID, { every: HOUR_MS }, { name: END_SCHEDULER_ID });
    await this.queue.upsertJobScheduler(RECORD_SCHEDULER_ID, { every: RECORD_EVERY_MS }, { name: RECORD_SCHEDULER_ID });
  }
}
