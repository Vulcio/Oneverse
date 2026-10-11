import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { TEAM_EVENTS_QUEUE } from "../jobs/jobs.constants.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { AvailabilityService } from "./availability.service.js";
import { CalendarFeedController, MyCalendarFeedController } from "./calendar-feed.controller.js";
import { CalendarFeedService } from "./calendar-feed.service.js";
import { MyCalendarController } from "./my-calendar.controller.js";
import { LineupService } from "./lineup.service.js";
import { RemindersService } from "./reminders.service.js";
import { TeamEventsController } from "./team-events.controller.js";
import { TeamEventsProcessor, TeamEventsScheduler } from "./team-events.processor.js";
import { TeamEventsService } from "./team-events.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: TEAM_EVENTS_QUEUE }), NotificationsModule],
  controllers: [TeamEventsController, MyCalendarController, MyCalendarFeedController, CalendarFeedController],
  providers: [TeamEventsService, AvailabilityService, RemindersService, LineupService, CalendarFeedService, TeamEventsProcessor, TeamEventsScheduler],
})
export class TeamEventsModule {}
