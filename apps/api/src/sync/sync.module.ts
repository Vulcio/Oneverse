import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { LIVE_SESSIONS_QUEUE } from "../jobs/jobs.constants.js";
import { AuthModule } from "../auth/auth.module.js";
import { ScreensModule } from "../screens/screens.module.js";
import { SetlistsModule } from "../setlists/setlists.module.js";
import { LiveSessionsProcessor, LiveSessionsScheduler } from "./live-sessions.js";
import { SyncServer } from "./sync.server.js";

/** Sync play (issue #13): the WebSocket at /sync, attached in main.ts. */
@Module({
  imports: [AuthModule, SetlistsModule, ScreensModule, BullModule.registerQueue({ name: LIVE_SESSIONS_QUEUE })],
  providers: [SyncServer, LiveSessionsProcessor, LiveSessionsScheduler],
  exports: [SyncServer],
})
export class SyncModule {}
