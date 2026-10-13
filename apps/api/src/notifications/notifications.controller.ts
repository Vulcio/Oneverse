import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Post, Put, Query, UnauthorizedException } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
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
  list(@CurrentUser() user: AuthenticatedUser | undefined, @Query() query: NotificationsQueryDto) {
    if (!user) throw new UnauthorizedException();
    return this.notifications.list(user.id, query.before, query.limit);
  }

  /** How many are unread: for the bell's badge, asked for often. */
  @Get("unread")
  async unread(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return { unread: await this.notifications.unread(user.id) };
  }

  /** These notifications marked read, or all of them when no `ids` are given. */
  @Post("read")
  read(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: MarkNotificationsReadDto) {
    if (!user) throw new UnauthorizedException();
    return this.notifications.markRead(user.id, dto.ids);
  }

  /** How each kind reaches one besides the bell (email), and whether this server emails at all. */
  @Get("settings")
  settings(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return this.notifications.preferences(user.id);
  }

  @Put("settings")
  updateSettings(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: UpdateNotificationPreferencesDto) {
    if (!user) throw new UnauthorizedException();
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
  list(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return this.notifications.devices(user.id);
  }

  /** This device turned on: its browser's PushSubscription, as toJSON() gives it. */
  @Post()
  add(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: CreatePushSubscriptionDto, @Headers("origin") origin?: string) {
    if (!user) throw new UnauthorizedException();
    return this.notifications.addDevice(user.id, dto, origin);
  }

  /** A test notification to all one's devices. */
  @Post("test")
  @HttpCode(HttpStatus.ACCEPTED)
  test(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return this.notifications.testPush(user.id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser | undefined, @Param("id") id: string) {
    if (!user) throw new UnauthorizedException();
    return this.notifications.removeDevice(user.id, id);
  }
}
