import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import type { ChartReading } from "@oneverse/core";
import { CHART_READING_QUEUE, JOB_WORKER_OPTIONS } from "../jobs/jobs.constants.js";
import { readChart } from "./read-chart.js";

/** A file being read: whose, and its bytes (base64), kept only as long as the job. */
export interface ChartReadingJob {
  userId: string;
  name: string;
  file: string;
}

/**
 * A PDF's or a picture's chart read for a device that couldn't (issue #124):
 * the same reading as on the device - its text, or OCR - in the Worker, so
 * the API never does OCR inside a request. One file at a time.
 */
@Processor(CHART_READING_QUEUE, { ...JOB_WORKER_OPTIONS, lockDuration: 180_000 })
export class ChartReadingProcessor extends WorkerHost {
  private readonly logger = new Logger(ChartReadingProcessor.name);

  async process(job: Job<ChartReadingJob>): Promise<NonNullable<ChartReading["result"]>> {
    try {
      return await readChart(Buffer.from(job.data.file, "base64"), (progress) => job.updateProgress(progress));
    } catch (error) {
      this.logger.warn(`Couldn't read ${job.data.name}: ${error instanceof Error ? error.message : String(error)}`);
      // Read once: the same file won't read better a second time.
      throw new UnrecoverableError("The file couldn't be read");
    }
  }
}
