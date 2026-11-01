import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Job, Queue } from "bullmq";
import { JOB_WORKER_OPTIONS, OWN_STORAGE_QUEUE } from "../jobs/jobs.constants.js";
import { OWN_STORAGE_TICK, OwnStorageService, RELOCATE_JOB } from "./own-storage.service.js";

/** Files moved to and from organisations' own buckets (issue #206), one batch at a time, and a tick every ten minutes. */
@Processor(OWN_STORAGE_QUEUE, { ...JOB_WORKER_OPTIONS, lockDuration: 300_000 })
export class OwnStorageProcessor extends WorkerHost {
  constructor(private readonly ownStorage: OwnStorageService) {
    super();
  }

  async process(job: Job) {
    if (job.name === OWN_STORAGE_TICK) return this.ownStorage.tick();
    if (job.name === RELOCATE_JOB) return this.ownStorage.relocate();
    return { skipped: true };
  }
}

/** Registers the tick; upsertJobScheduler is idempotent across the API, the Worker and restarts. */
@Injectable()
export class OwnStorageScheduler implements OnModuleInit {
  constructor(@InjectQueue(OWN_STORAGE_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(OWN_STORAGE_TICK, { every: 10 * 60 * 1000 }, { name: OWN_STORAGE_TICK, opts: { removeOnComplete: 50, removeOnFail: 50 } });
  }
}
