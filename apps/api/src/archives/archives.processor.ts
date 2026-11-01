import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Job, Queue } from "bullmq";
import { ARCHIVES_QUEUE, JOB_WORKER_OPTIONS } from "../jobs/jobs.constants.js";
import { ARCHIVE_TICK, ArchivesService, EXPORT_JOB, IMPORT_JOB } from "./archives.service.js";

/**
 * People's, teams' and organisations' archives (issue #351): made, imported,
 * and an hourly tick for the weekly ones and the expired ones' files. One at
 * a time: an archive can be big.
 */
@Processor(ARCHIVES_QUEUE, { ...JOB_WORKER_OPTIONS, lockDuration: 120_000 })
export class ArchivesProcessor extends WorkerHost {
  constructor(private readonly archives: ArchivesService) {
    super();
  }

  async process(job: Job<{ archiveId?: string }>) {
    if (job.name === ARCHIVE_TICK) return this.archives.tick();
    if (!job.data.archiveId) return { skipped: true };
    if (job.name === EXPORT_JOB) return this.archives.runExport(job.data.archiveId);
    if (job.name === IMPORT_JOB) return this.archives.runImport(job.data.archiveId);
    return { skipped: true };
  }
}

/** Registers the hourly tick; upsertJobScheduler is idempotent across the API, the Worker and restarts. */
@Injectable()
export class ArchivesScheduler implements OnModuleInit {
  constructor(@InjectQueue(ARCHIVES_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(ARCHIVE_TICK, { every: 60 * 60 * 1000 }, { name: ARCHIVE_TICK, opts: { removeOnComplete: 50, removeOnFail: 50 } });
  }
}
