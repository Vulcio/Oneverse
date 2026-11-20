import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { NOTIFICATIONS_QUEUE } from "../jobs/jobs.constants.js";
import { AdminAnnouncementsController, OrganizationAnnouncementsController, TeamAnnouncementsController } from "./announcements.controller.js";
import { AnnouncementsService } from "./announcements.service.js";

/** Announcements (issue #536): sent through the notifications' queue, whose processor makes them. */
@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  controllers: [AdminAnnouncementsController, OrganizationAnnouncementsController, TeamAnnouncementsController],
  providers: [AnnouncementsService],
})
export class AnnouncementsModule {}
