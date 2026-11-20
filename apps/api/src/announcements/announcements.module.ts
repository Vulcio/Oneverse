import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { NOTIFICATIONS_QUEUE } from "../jobs/jobs.constants.js";
import { AdminAnnouncementsController, OrganizationAnnouncementsController } from "./announcements.controller.js";
import { AnnouncementsService } from "./announcements.service.js";

/** Announcements (issue #536): sent through the notifications' queue, whose processor makes them. */
@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  controllers: [AdminAnnouncementsController, OrganizationAnnouncementsController],
  providers: [AnnouncementsService],
})
export class AnnouncementsModule {}
