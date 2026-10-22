import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { Queue } from "bullmq";
import { JOB_WORKER_OPTIONS, LIVE_SESSIONS_QUEUE } from "../jobs/jobs.constants.js";
import { redis } from "../jobs/redis.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { sessionKey } from "./set-sessions.js";

// A set run live (issue #247, docs/live-session.md): its row, from when it starts until it ends.

const END_SCHEDULER_ID = "end-gone-live-sessions";
const HOUR_MS = 60 * 60 * 1000;

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
 * Hourly: LIVE sessions whose state is gone from Redis (nobody changed it for
 * SESSION_TTL_S) or is another session's now, ended.
 */
@Processor(LIVE_SESSIONS_QUEUE, JOB_WORKER_OPTIONS)
export class LiveSessionsProcessor extends WorkerHost {
  private readonly logger = new Logger(LiveSessionsProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(): Promise<void> {
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
  }
}

/** Registers the schedule; upsertJobScheduler is idempotent, so every process calling it leaves one. */
@Injectable()
export class LiveSessionsScheduler implements OnModuleInit {
  constructor(@InjectQueue(LIVE_SESSIONS_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(END_SCHEDULER_ID, { every: HOUR_MS }, { name: END_SCHEDULER_ID });
  }
}
