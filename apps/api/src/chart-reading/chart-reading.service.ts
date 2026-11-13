import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { ChartReading } from "@oneverse/core";
import type { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { CHART_READING_QUEUE } from "../jobs/jobs.constants.js";
import type { ChartReadingJob } from "./chart-reading.processor.js";
import { isPdfBytes } from "./read-chart.js";

/** A chart file read by the server is at most this big, as on the device (the song form's limit). */
export const CHART_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** How long a reading and its file are kept, to be followed and fetched. */
const KEPT_SECONDS = 15 * 60;

// The pictures Tesseract reads, by their first bytes: PNG, JPEG, WebP, GIF, BMP.
const IMAGE_SIGNATURES = [Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("RIFF"), Buffer.from("GIF8"), Buffer.from("BM")];

@Injectable()
export class ChartReadingService {
  constructor(@InjectQueue(CHART_READING_QUEUE) private readonly queue: Queue<ChartReadingJob>) {}

  /** A PDF or a picture put on the queue to be read; its id, to follow it. */
  async start(userId: string, file: { buffer: Buffer; originalname: string; size: number }): Promise<{ id: string }> {
    if (file.size > CHART_FILE_MAX_BYTES) throw new BadRequestException(["file must be at most 10 MB"]);
    const head = file.buffer.subarray(0, 4);
    if (!isPdfBytes(file.buffer) && !IMAGE_SIGNATURES.some((signature) => head.subarray(0, signature.length).equals(signature))) {
      throw new BadRequestException(["file must be a PDF or a picture (PNG, JPEG, WebP, GIF or BMP)"]);
    }
    const id = randomUUID();
    await this.queue.add(
      "read",
      { userId, name: file.originalname.slice(0, 200), file: file.buffer.toString("base64") },
      { jobId: id, attempts: 1, removeOnComplete: { age: KEPT_SECONDS }, removeOnFail: { age: KEPT_SECONDS } },
    );
    return { id };
  }

  /** Where a reading is: only its own person's. */
  async get(userId: string, id: string): Promise<ChartReading> {
    const job = await this.queue.getJob(id);
    if (!job || job.data.userId !== userId) throw new NotFoundException("No such reading");
    const state = await job.getState();
    if (state === "completed") return { state: "read", result: job.returnvalue };
    if (state === "failed") return { state: "failed" };
    const progress = typeof job.progress === "object" && job.progress !== null ? (job.progress as { page: number; pages: number }) : null;
    return { state: state === "active" ? "reading" : "waiting", progress };
  }
}
