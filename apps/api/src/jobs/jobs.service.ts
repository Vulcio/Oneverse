import { InjectQueue } from "@nestjs/bullmq";
import { SCRIPTURES_QUEUE } from "../scriptures/bibles.types.js";
import { Injectable } from "@nestjs/common";
import type { Job, Queue } from "bullmq";
import { BULK_UPLOAD_QUEUE } from "../bulk-upload/bulk-upload.types.js";
import { USER_MAINTENANCE_QUEUE } from "../user-management/transfer-expiry.processor.js";
import { BACKFILLS_QUEUE, HEARTBEAT_KEY, jobsInApi, LOOKUPS_QUEUE, RECORDINGS_QUEUE, settingsKeyCheck, STEM_SEPARATION_QUEUE, TEAM_EVENTS_QUEUE, NOTIFICATIONS_QUEUE, LIVE_SESSIONS_QUEUE } from "./jobs.constants.js";
import { redis } from "./redis.js";
import { BACKUPS_QUEUE } from "./jobs.constants.js";
import { latestMigration } from "../common/database-migration.js";
import { serverVersion } from "../common/version.js";
import { PrismaService } from "../prisma/prisma.service.js";

interface Beat {
  at: string;
  host: string;
  /**
   * Its SETTINGS_ENCRYPTION_KEY against this API's (issue #95): "missing",
   * "different", "same", or null from a Worker too old to say.
   */
  settingsKey: "missing" | "different" | "same" | null;
  /** Its ffmpeg's version, "" when it has none (recorded takes stay WAV, issue #127), or null from a process too old to say. */
  ffmpeg: string | null;
  /** Its version (issue #164), or null from a process too old to say: a Worker not redeployed with the API differs. */
  version: string | null;
}

export interface JobsStatus {
  /** This API's version and commit (issue #164), and the database's latest migration. */
  server: { version: string; commit: string | null; migration: string | null };
  /** The Worker's last heartbeat (every 15 seconds; gone after a minute), or null. */
  worker: Beat | null;
  /** An API process that runs jobs itself (JOBS_IN_API), or null. */
  api: Beat | null;
  /** Whether the API answering this runs jobs. */
  thisApiRunsJobs: boolean;
  queues: { name: string; waiting: number; active: number; delayed: number; failed: number; completed: number }[];
  /** The last jobs done, newest first. */
  recent: JobSummary[];
  /** The jobs that failed, newest first, with why (issue #93). */
  failed: JobSummary[];
  /** Failed jobs counted but whose details are gone (an older deployment's), by queue. */
  failedWithoutDetails: number;
}

export interface JobSummary {
  id: string | null;
  queue: string;
  name: string;
  state: "completed" | "failed";
  finishedAt: string | null;
  result: unknown;
  error: string | null;
  subject: string | null;
}

/** Background jobs' state, for Admin > Metadata (issue #92). */
@Injectable()
export class JobsService {
  constructor(
    @InjectQueue(LOOKUPS_QUEUE) private readonly lookups: Queue,
    @InjectQueue(BACKFILLS_QUEUE) private readonly backfills: Queue,
    @InjectQueue(BULK_UPLOAD_QUEUE) private readonly bulkUpload: Queue,
    @InjectQueue(USER_MAINTENANCE_QUEUE) private readonly maintenance: Queue,
    @InjectQueue(RECORDINGS_QUEUE) private readonly recordings: Queue,
    @InjectQueue(STEM_SEPARATION_QUEUE) private readonly stemSeparation: Queue,
    @InjectQueue(TEAM_EVENTS_QUEUE) private readonly teamEvents: Queue,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notifications: Queue,
    @InjectQueue(SCRIPTURES_QUEUE) private readonly scriptures: Queue,
    @InjectQueue(LIVE_SESSIONS_QUEUE) private readonly liveSessions: Queue,
    @InjectQueue(BACKUPS_QUEUE) private readonly backups: Queue,
    private readonly prisma: PrismaService,
  ) {}

  private get queues(): Queue[] {
    return [this.lookups, this.backfills, this.bulkUpload, this.maintenance, this.recordings, this.stemSeparation, this.teamEvents, this.notifications, this.scriptures, this.liveSessions, this.backups];
  }

  async status(): Promise<JobsStatus> {
    const beat = async (role: "worker" | "api") => {
      try {
        const raw = await redis().get(HEARTBEAT_KEY(role));
        if (!raw) return null;
        const { at, host, settingsKey, ffmpeg, version } = JSON.parse(raw) as { at: string; host: string; settingsKey?: string | null; ffmpeg?: string | null; version?: string };
        const mine = settingsKeyCheck();
        const key = settingsKey === undefined ? null : settingsKey === null ? "missing" : settingsKey === mine ? "same" : "different";
        // Only the verdict: the hash stays in Redis.
        return { at, host, settingsKey: key, ffmpeg: ffmpeg === undefined ? null : (ffmpeg ?? ""), version: version ?? null } satisfies Beat;
      } catch {
        return null;
      }
    };
    const queues = this.queues;
    const [migration, worker, api, counts, completed, failedJobs] = await Promise.all([
      latestMigration(this.prisma.client),
      beat("worker"),
      beat("api"),
      Promise.all(queues.map((queue) => queue.getJobCounts("waiting", "active", "delayed", "failed", "completed", "prioritized"))),
      Promise.all(queues.map((queue) => queue.getJobs(["completed"], 0, 14))),
      Promise.all(queues.map((queue) => queue.getJobs(["failed"], 0, 19))),
    ]);
    const summary = (state: "completed" | "failed") => (job: Job): JobSummary => {
      const data = job.data as { name?: string; songVersionId?: string; filename?: string } | undefined;
      return {
        id: job.id ?? null,
        queue: job.queueName,
        name: job.name,
        state,
        finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        result: job.returnvalue ?? null,
        error: job.failedReason || null,
        // What it was about, shown beside it: an artist's name, a file's.
        subject: data?.name ?? data?.filename ?? null,
      };
    };
    const newestFirst = (a: JobSummary, b: JobSummary) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? "");
    const recent = completed.flat().filter(Boolean).map(summary("completed")).sort(newestFirst);
    const failed = failedJobs.flat().filter(Boolean).map(summary("failed")).sort(newestFirst);
    // A queue counts failed jobs by their IDs; one whose details were removed isn't listed.
    const failedWithoutDetails = counts.reduce((sum, c, index) => sum + Math.max(0, (c.failed ?? 0) - Math.min(failedJobs[index]!.length, 20)), 0);
    return {
      server: { ...serverVersion(), migration },
      worker,
      api,
      thisApiRunsJobs: jobsInApi(),
      queues: queues.map((queue, index) => {
        const c = counts[index]!;
        return { name: queue.name, waiting: (c.waiting ?? 0) + (c.prioritized ?? 0), active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0, completed: c.completed ?? 0 };
      }),
      recent: recent.slice(0, 15),
      failed: failed.slice(0, 20),
      failedWithoutDetails,
    };
  }

  /**
   * A scheduled job run now, besides its schedule (issue #235): the team
   * calendar's sets ahead and reminders, the old notifications' clean-up
   * (issue #149), the live sessions' record and clean-up (issue #247). Null:
   * not one of them.
   */
  async runNow(name: string): Promise<{ queued: string } | null> {
    const scheduled: Record<string, Queue> = { "make-event-sets": this.teamEvents, "event-reminders": this.teamEvents, "clean-up-notifications": this.notifications, "record-live-sessions": this.liveSessions, "end-gone-live-sessions": this.liveSessions };
    const queue = scheduled[name];
    if (!queue) return null;
    await queue.add(name, {}, { removeOnComplete: 100, removeOnFail: 100 });
    return { queued: name };
  }

  /** Clears every queue's failed jobs (issue #93), those without details left too; returns how many. */
  async clearFailed(): Promise<{ cleared: number }> {
    let cleared = 0;
    for (const queue of this.queues) {
      cleared += (await queue.clean(0, 100000, "failed")).length;
      // IDs left in the failed set with no job behind them: clean() only sees jobs it can read.
      const client = await queue.client;
      const key = queue.toKey("failed");
      const orphans = await client.zcard(key);
      if (orphans > 0) {
        await client.del(key);
        cleared += orphans;
      }
    }
    return { cleared };
  }
}
