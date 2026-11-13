import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { CHART_READING_QUEUE } from "../jobs/jobs.constants.js";
import { ChartReadingController } from "./chart-reading.controller.js";
import { ChartReadingProcessor } from "./chart-reading.processor.js";
import { ChartReadingService } from "./chart-reading.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: CHART_READING_QUEUE })],
  controllers: [ChartReadingController],
  providers: [ChartReadingService, ChartReadingProcessor],
})
export class ChartReadingModule {}
