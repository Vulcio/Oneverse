import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { startJobs } from "./jobs/start-jobs.js";
import { reportProcessErrors } from "./error-reporting/error-reporter.js";

/**
 * The Worker (issue #92): the same image and app graph as the API
 * (src/main.ts), with no HTTP listener, running the background jobs - bulk
 * songbook uploads, the hourly purge of expired transfers, and lookups (a
 * new song's artwork, new artists' pictures and bios, the admin's
 * backfills). The API only adds jobs to the queues, unless JOBS_IN_API
 * says it runs them too (by default, out of production, so `pnpm dev`
 * works without a Worker). Its heartbeat in Redis shows it's running in
 * Admin > Metadata > Background jobs.
 *
 * The queues' Redis connections hold the event loop open; the heartbeat's
 * timer does too.
 */
async function bootstrap() {
  // What nothing caught is reported before the process goes (issue #469).
  reportProcessErrors("worker");
  const app = await NestFactory.createApplicationContext(AppModule);
  const stopHeartbeat = startJobs(app, "worker");
  console.log("Songverse worker started");

  const shutdown = async (signal: string) => {
    console.log(`Songverse worker received ${signal}, shutting down`);
    stopHeartbeat();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void bootstrap();
