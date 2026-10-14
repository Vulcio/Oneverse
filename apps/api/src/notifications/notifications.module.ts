import { BullModule } from "@nestjs/bullmq";
import { Global, Module } from "@nestjs/common";
import { NOTIFICATIONS_QUEUE } from "../jobs/jobs.constants.js";
import { NotificationsController, PushSubscriptionsController } from "./notifications.controller.js";
import { NotificationsProcessor, NotificationsScheduler } from "./notifications.processor.js";
import { NotificationsService } from "./notifications.service.js";

/** Global (issue #149): every part of the API tells people what happened for them. */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  controllers: [NotificationsController, PushSubscriptionsController],
  providers: [NotificationsService, NotificationsProcessor, NotificationsScheduler],
  exports: [NotificationsService],
})
export class NotificationsModule {}
