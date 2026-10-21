import type { INestApplicationContext } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import type { WorkerHost } from "@nestjs/bullmq";
import { hostname } from "node:os";
import { BulkUploadProcessor } from "../bulk-upload/bulk-upload.processor.js";
import { BackfillsProcessor, LookupsProcessor } from "../lookups/lookups.processor.js";
import { RecordingsProcessor } from "../recordings/recordings.processor.js";
import { StemSeparationProcessor } from "../stem-separation/stem-separation.processor.js";
import { ffmpegVersion } from "../recordings/ffmpeg.js";
import { NotificationsProcessor } from "../notifications/notifications.processor.js";
import { TeamEventsProcessor } from "../team-events/team-events.processor.js";
import { BibleImportProcessor } from "../scriptures/bibles.processor.js";
import { TransferExpiryProcessor } from "../user-management/transfer-expiry.processor.js";
import { HEARTBEAT_KEY, settingsKeyCheck } from "./jobs.constants.js";
import { redis } from "./redis.js";

/** Every job processor: a new one needs adding here, or no process runs its jobs. */
const PROCESSORS = [BulkUploadProcessor, TransferExpiryProcessor, LookupsProcessor, BackfillsProcessor, RecordingsProcessor, StemSeparationProcessor, TeamEventsProcessor, NotificationsProcessor, BibleImportProcessor];

const logger = new Logger("Jobs");

/**
 * Starts running jobs in this process (issue #92) - the Worker's, or the
 * API's with JOBS_IN_API - and says so in Redis every 15 seconds, for
 * Admin > Metadata > Background jobs. Returns a stop for the heartbeat.
 */
export function startJobs(app: INestApplicationContext, role: "worker" | "api"): () => void {
  const queues: string[] = [];
  for (const processor of PROCESSORS) {
    const host = app.get<WorkerHost>(processor, { strict: false });
    queues.push(host.worker.name);
    host.worker.run().catch((err: unknown) => logger.error(`${processor.name} stopped: ${err instanceof Error ? err.message : String(err)}`));
  }
  // Whether this process can process recorded takes (issue #127), for Admin.
  let ffmpeg: string | null | undefined;
  const beat = () =>
    redis()
      .set(HEARTBEAT_KEY(role), JSON.stringify({ at: new Date().toISOString(), host: hostname(), pid: process.pid, settingsKey: settingsKeyCheck(), ffmpeg }), "EX", 60)
      .catch(() => undefined);
  void ffmpegVersion().then((version) => {
    ffmpeg = version;
    if (!version) logger.warn("ffmpeg isn't installed: recorded takes stay as WAV");
    void beat();
  });
  void beat();
  const timer = setInterval(beat, 15000);
  // Named, so a deploy's logs show which queues this process runs.
  logger.log(`Running background jobs in the ${role}: ${queues.join(", ")}`);
  return () => clearInterval(timer);
}
