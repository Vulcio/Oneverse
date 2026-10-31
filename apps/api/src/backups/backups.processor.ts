import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Job, Queue } from "bullmq";
import { BACKUPS_QUEUE, JOB_WORKER_OPTIONS } from "../jobs/jobs.constants.js";
import { BackupService, type BackupTrigger } from "./backup.service.js";

const TICK = "backup-tick";
export const BACKUP_NOW = "backup";

/**
 * The server's backups (issue #119): an hourly tick that starts the nightly
 * backup at its hour, and "Back up now" from Admin. One at a time (the
 * worker's concurrency is 1, and a run that's going on is checked).
 */
@Processor(BACKUPS_QUEUE, { ...JOB_WORKER_OPTIONS, lockDuration: 120_000 })
export class BackupsProcessor extends WorkerHost {
  constructor(private readonly backups: BackupService) {
    super();
  }

  async process(job: Job<{ trigger?: BackupTrigger }>) {
    if (job.name === TICK) return { outcome: await this.backups.tick() };
    return this.backups.run(job.data.trigger ?? "manual");
  }
}

/** Registers the hourly tick; upsertJobScheduler is idempotent across the API, the Worker and restarts. */
@Injectable()
export class BackupsScheduler implements OnModuleInit {
  constructor(@InjectQueue(BACKUPS_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(TICK, { every: 60 * 60 * 1000 }, { name: TICK, opts: { removeOnComplete: 50, removeOnFail: 50 } });
  }
}
