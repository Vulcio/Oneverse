import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { MarkNotificationsReadDto, NotificationsQueryDto, UpdateNotificationPreferencesDto } from "./dto/notifications.dto.js";
import { CreatePushSubscriptionDto } from "./dto/push.dto.js";
import { NotificationsService } from "./notifications.service.js";

/** One's own notifications (issue #236). */
@ApiTags("notifications")
@ApiBearerAuth()
@Controller("users/me/notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Newest first, with how many are unread. */
  @Get()
  list(@SignedIn() user: AuthenticatedUser, @Query() query: NotificationsQueryDto) {
    return this.notifications.list(user.id, query.before, query.limit);
  }

  /** How many are unread: for the bell's badge, asked for often. */
  @Get("unread")
  async unread(@SignedIn() user: AuthenticatedUser) {
    return { unread: await this.notifications.unread(user.id) };
  }

  /** These notifications marked read, or all of them when no `ids` are given. */
  @Post("read")
  read(@SignedIn() user: AuthenticatedUser, @Body() dto: MarkNotificationsReadDto) {
    return this.notifications.markRead(user.id, dto.ids);
  }

  /** How each kind reaches one besides the bell (email), and whether this server emails at all. */
  @Get("settings")
  settings(@SignedIn() user: AuthenticatedUser) {
    return this.notifications.preferences(user.id);
  }

  @Put("settings")
  updateSettings(@SignedIn() user: AuthenticatedUser, @Body() dto: UpdateNotificationPreferencesDto) {
    return this.notifications.updatePreferences(user.id, dto);
  }
}

/** The devices one turned notifications on for (issue #236): their browsers' push subscriptions. */
@ApiTags("notifications")
@ApiBearerAuth()
@Controller("users/me/push-subscriptions")
export class PushSubscriptionsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@SignedIn() user: AuthenticatedUser) {
    return this.notifications.devices(user.id);
  }

  /** This device turned on: its browser's PushSubscription, as toJSON() gives it. */
  @Post()
  add(@SignedIn() user: AuthenticatedUser, @Body() dto: CreatePushSubscriptionDto, @Headers("origin") origin?: string) {
    return this.notifications.addDevice(user.id, dto, origin);
  }

  /** A test notification to all one's devices. */
  @Post("test")
  @HttpCode(HttpStatus.ACCEPTED)
  test(@SignedIn() user: AuthenticatedUser) {
    return this.notifications.testPush(user.id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@SignedIn() user: AuthenticatedUser, @Param("id") id: string) {
    return this.notifications.removeDevice(user.id, id);
  }
}
