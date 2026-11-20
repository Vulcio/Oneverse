import "../zod-config.js";
import { z } from "zod";
import { NOTIFICATION_KINDS } from "../notifications/index.js";
import { isTimeOfDay, isTimeZone } from "../calendar/index.js";
import { clearableText, optional, queryBoolean, queryInt } from "./fields.js";

/** Someone's notifications (issue #236): newest first, a page at a time. */
export const NotificationsQuerySchema = z.strictObject({
  before: optional(z.string().trim().max(64)).describe("The ID of the last notification already shown: the page after it"),
  limit: optional(queryInt().pipe(z.number().min(1).max(100))).describe("Defaults to 30"),
  announcements: optional(queryBoolean()).describe("Only announcements (issue #536): the news Oneverse's home shows (issue #538)"),
});

/** Notifications marked read: these, or all of them when `ids` is left out. */
export const MarkNotificationsReadSchema = z.strictObject({
  ids: optional(z.array(z.string().trim().min(1).max(64)).max(200)),
});

/** How each kind of notification reaches someone: a choice left out stays as it was. */
export const UpdateNotificationPreferencesSchema = z.strictObject({
  kinds: optional(z.partialRecord(z.enum(NOTIFICATION_KINDS), z.strictObject({ email: optional(z.boolean()), push: optional(z.boolean()) }))),
  quiet: z
    .strictObject({
      from: z.string().refine(isTimeOfDay, "quiet.from must be a time, HH:MM"),
      to: z.string().refine(isTimeOfDay, "quiet.to must be a time, HH:MM"),
      timeZone: z.string().refine(isTimeZone, "quiet.timeZone must be a time zone"),
    })
    .refine((quiet) => quiet.from !== quiet.to, "quiet.to must not be the same as quiet.from")
    .nullable()
    .optional()
    .describe("Hours one's devices stay quiet; null: none"),
});
export type UpdateNotificationPreferencesRequest = z.input<typeof UpdateNotificationPreferencesSchema>;

/** PUT /admin/notifications: left out keeps its value; null goes back to the environment variable or the default. */
export const SaveNotificationServerSettingsSchema = z.strictObject({
  emailEnabled: z.boolean().nullable().optional().describe("Notifications sent by email at all (NOTIFICATION_EMAILS)"),
  vapidPublicKey: clearableText(200).describe("Web push's VAPID public key (VAPID_PUBLIC_KEY); saved with its private key"),
  vapidPrivateKey: clearableText(200).describe("Its private key, kept encrypted (VAPID_PRIVATE_KEY)"),
  vapidSubject: clearableText(300).describe("Who sends the pushes, mailto: or https: (VAPID_SUBJECT)"),
});

/** A device's push subscription (issue #236), as the browser's PushSubscription.toJSON() gives it. */
export const CreatePushSubscriptionSchema = z.strictObject({
  endpoint: z.string().trim().min(1).max(2048).describe("The push service's address for this device"),
  keys: z.strictObject({ p256dh: z.string().trim().min(1).max(200), auth: z.string().trim().min(1).max(100) }),
  expirationTime: z.number().nullable().optional(),
  label: optional(z.string().trim().max(100)).describe("Which device: \"Chrome on Android\""),
});
export type CreatePushSubscriptionRequest = z.input<typeof CreatePushSubscriptionSchema>;
export type SaveNotificationServerSettingsRequest = z.input<typeof SaveNotificationServerSettingsSchema>;
