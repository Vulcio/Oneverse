import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { BULK_UPLOAD_QUEUE } from "../bulk-upload/bulk-upload.types.js";
import { USER_MAINTENANCE_QUEUE } from "../user-management/transfer-expiry.processor.js";
import { SCRIPTURES_QUEUE } from "../scriptures/bibles.types.js";
import { JobsController } from "./jobs.controller.js";
import { ARCHIVES_QUEUE, BACKUPS_QUEUE, OWN_STORAGE_QUEUE, SONG_INFO_QUEUE } from "./jobs.constants.js";
import { BACKFILLS_QUEUE, LOOKUPS_QUEUE, RECORDINGS_QUEUE, STEM_SEPARATION_QUEUE, TEAM_EVENTS_QUEUE, NOTIFICATIONS_QUEUE, LIVE_SESSIONS_QUEUE } from "./jobs.constants.js";
import { JobsService } from "./jobs.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: LOOKUPS_QUEUE }, { name: BACKFILLS_QUEUE }, { name: BULK_UPLOAD_QUEUE }, { name: USER_MAINTENANCE_QUEUE }, { name: RECORDINGS_QUEUE }, { name: STEM_SEPARATION_QUEUE }, { name: TEAM_EVENTS_QUEUE }, { name: NOTIFICATIONS_QUEUE }, { name: SCRIPTURES_QUEUE }, { name: LIVE_SESSIONS_QUEUE }, { name: BACKUPS_QUEUE }, { name: ARCHIVES_QUEUE }, { name: OWN_STORAGE_QUEUE }, { name: SONG_INFO_QUEUE })],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
