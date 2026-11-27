import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { REGISTRATIONS_QUEUE } from "../jobs/jobs.constants.js";
import { PublicRegistrationsController, RegistrationsController } from "./registrations.controller.js";
import { RegistrationsProcessor, RegistrationsScheduler } from "./registrations.processor.js";
import { RegistrationsService } from "./registrations.service.js";

/** Registration for event dates (issue #593). */
@Module({
  imports: [BullModule.registerQueue({ name: REGISTRATIONS_QUEUE })],
  controllers: [RegistrationsController, PublicRegistrationsController],
  providers: [RegistrationsService, RegistrationsProcessor, RegistrationsScheduler],
})
export class RegistrationsModule {}
