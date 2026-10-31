import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { JOB_WORKER_OPTIONS } from "../jobs/jobs.constants.js";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { Queue } from "bullmq";
import { ContentTransfersService } from "./content-transfers.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { purgeExpiredBin } from "../song-versions/song-bin.service.js";

export const USER_MAINTENANCE_QUEUE = "user-maintenance";
const PURGE_SCHEDULER_ID = "purge-expired-transfers";
const HOUR_MS = 60 * 60 * 1000;

/** Hourly: deletes accounts whose transfer link expired unclaimed, with their content, and songs in the bin for 30 days (issue #340). */
@Processor(USER_MAINTENANCE_QUEUE, JOB_WORKER_OPTIONS)
export class TransferExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(TransferExpiryProcessor.name);

  constructor(
    private readonly transfers: ContentTransfersService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const purged = await this.transfers.purgeExpired();
    if (purged > 0) this.logger.log(`Purged ${purged} expired content transfer(s)`);
    const binned = await purgeExpiredBin(this.prisma, this.storage);
    if (binned > 0) this.logger.log(`Deleted for good ${binned} song(s) from the bin`);
  }
}

/**
 * Registers the schedule. upsertJobScheduler is idempotent, so the API and
 * Worker (and restarts of either) all calling it still leaves one schedule.
 */
@Injectable()
export class TransferExpiryScheduler implements OnModuleInit {
  constructor(@InjectQueue(USER_MAINTENANCE_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(PURGE_SCHEDULER_ID, { every: HOUR_MS }, { name: PURGE_SCHEDULER_ID });
  }
}
