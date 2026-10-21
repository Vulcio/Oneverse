import { MarkNotificationsReadSchema, NotificationsQuerySchema, UpdateNotificationPreferencesSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class NotificationsQueryDto extends zodDto(NotificationsQuerySchema) {}
export class MarkNotificationsReadDto extends zodDto(MarkNotificationsReadSchema) {}
export class UpdateNotificationPreferencesDto extends zodDto(UpdateNotificationPreferencesSchema) {}
