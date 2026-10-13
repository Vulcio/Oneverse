import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { notificationEmail, notificationPreferences, notificationPush, quietHoursEnd, quietHoursOf, type Messages, type NotificationData, type NotificationKind } from "@songverse/core";
import en from "@songverse/core/i18n/locales/en";
import fr from "@songverse/core/i18n/locales/fr";
import type { Job, Queue } from "bullmq";
import { sendNotificationEmail } from "../auth/email.js";
import { JOB_WORKER_OPTIONS, NOTIFICATIONS_QUEUE } from "../jobs/jobs.constants.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { getEffectiveNotificationSettings, getPushConfigOrError, type PushConfig } from "./notification-settings.js";
import type { DeliverJob, TestPushJob } from "./notifications.service.js";
import { pushSubject, sendPush, type PushPayload } from "./push-sender.js";

const MESSAGES: Record<string, Messages> = { en, fr };

type Rows = Awaited<ReturnType<NotificationsProcessor["load"]>>;

/** Where a notification's link goes (issue #241): Planiverse's address for its own, when it's deployed; Songverse's otherwise. */
function appUrl(job: DeliverJob, app: string | null): string {
  return app === "planiverse" && job.planiverseUrl ? job.planiverseUrl : job.webUrl;
}

/**
 * Notifications sent out (issue #236), each batch made together:
 * - by email, one per person - when this server sends them (Admin >
 *   Notifications) and the person wants that kind by email, to an address
 *   they've verified;
 * - to their devices (web push), one push per person - when push is set
 *   up and they want that kind pushed; during their quiet hours, held
 *   until they end (a "push" job, delayed).
 * Each notification is marked once looked at for each, sent or not, so a
 * retried job never sends it twice. "test": a test push to someone's devices.
 * Why a push failed is kept on its device and logged (issue #237); a test
 * that reaches no device, and push that's set up but can't be used here (a
 * key this Worker can't decrypt), fail the job with the reason.
 */
@Processor(NOTIFICATIONS_QUEUE, JOB_WORKER_OPTIONS)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job<DeliverJob | TestPushJob>): Promise<{ emailed: number; pushed: number }> {
    if (job.name === "test") return { emailed: 0, pushed: await this.test(job.data as TestPushJob) };
    const data = job.data as DeliverJob;
    const emailed = job.name === "deliver" ? await this.email(data) : 0;
    const pushed = await this.push(data);
    if (emailed + pushed > 0) this.logger.log(`Notifications: emailed ${emailed}, pushed to ${pushed} person(s)`);
    return { emailed, pushed };
  }

  private load(ids: string[], where: { emailedAt: null } | { pushedAt: null }) {
    return this.prisma.client.notification.findMany({
      where: { id: { in: ids }, ...where },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { email: true, emailVerified: true, locale: true, notificationSettings: true } } },
    });
  }

  private byUser(rows: Rows): Rows[] {
    const groups = new Map<string, Rows>();
    for (const row of rows) groups.set(row.userId, [...(groups.get(row.userId) ?? []), row]);
    return [...groups.values()];
  }

  private async email(job: DeliverJob): Promise<number> {
    const rows = await this.load(job.ids, { emailedAt: null });
    if (rows.length === 0) return 0;
    const { emailEnabled } = await getEffectiveNotificationSettings();
    let emailed = 0;
    for (const list of this.byUser(rows)) {
      const user = list[0]!.user;
      const choices = notificationPreferences(user.notificationSettings);
      const wanted = emailEnabled && user.emailVerified ? list.filter((row) => choices[row.kind as NotificationKind]?.email) : [];
      if (wanted.length > 0) {
        const messages = MESSAGES[user.locale] ?? en;
        const email = notificationEmail(wanted.map((row) => ({ kind: row.kind as NotificationKind, data: row.data as NotificationData })), messages, user.locale);
        // One link: the first one's (they're about the same thing), else My calendar - in its app (issue #241).
        const first = wanted.find((row) => row.url) ?? wanted[0]!;
        const path = first.url ?? "/calendar";
        await sendNotificationEmail(user.email, {
          ...email,
          open: messages.notifications.email.open.replace("{{app}}", first.app === "planiverse" && job.planiverseUrl ? "Planiverse" : "Songverse"),
          url: `${appUrl(job, first.app)}${path}`,
          why: messages.notifications.email.why,
          settingsUrl: `${appUrl(job, first.app)}/account`,
        });
        emailed += 1;
      }
      await this.prisma.client.notification.updateMany({ where: { id: { in: list.map((row) => row.id) } }, data: { emailedAt: new Date() } });
    }
    return emailed;
  }

  private async push(job: DeliverJob): Promise<number> {
    const rows = await this.load(job.ids, { pushedAt: null });
    if (rows.length === 0) return 0;
    const { config, error } = await getPushConfigOrError();
    let pushed = 0;
    for (const list of this.byUser(rows)) {
      const user = list[0]!.user;
      const choices = notificationPreferences(user.notificationSettings);
      const wanted = config || error ? list.filter((row) => choices[row.kind as NotificationKind]?.push) : [];
      const all = wanted.length > 0 ? await this.prisma.client.pushSubscription.findMany({ where: { userId: list[0]!.userId } }) : [];
      // Its app's devices (issue #241: Planiverse's, Songverse's), or every one when they have none of that app's.
      const first = wanted.find((row) => row.url) ?? wanted[0];
      const theirs = all.filter((device) => (device.app ?? null) === (first?.app ?? null));
      const devices = theirs.length > 0 ? theirs : all;
      // Set up, but this Worker can't use it: the job fails with why, these left to push once it can.
      if (devices.length > 0 && !config) throw new Error(error ?? "Push isn't set up");
      if (devices.length > 0) {
        const end = quietHoursEnd(quietHoursOf(user.notificationSettings), new Date());
        if (end) {
          // Quiet hours: held until they end, then looked at again (they may have changed).
          await this.queue.add("push", { ids: list.map((row) => row.id), webUrl: job.webUrl, planiverseUrl: job.planiverseUrl ?? null } satisfies DeliverJob, { delay: Math.max(0, new Date(end).getTime() - Date.now()), removeOnComplete: 100, removeOnFail: 100 });
          continue;
        }
        const messages = MESSAGES[user.locale] ?? en;
        const text = notificationPush(wanted.map((row) => ({ kind: row.kind as NotificationKind, data: row.data as NotificationData })), messages, user.locale);
        const sent = await this.toDevices(devices, { ...text, url: first?.url ?? "/calendar", tag: wanted.length === 1 ? wanted[0]!.id : undefined }, config!, job.webUrl);
        if (sent.sent > 0) pushed += 1;
      }
      await this.prisma.client.notification.updateMany({ where: { id: { in: list.map((row) => row.id) } }, data: { pushedAt: new Date() } });
    }
    return pushed;
  }

  /**
   * A push to each device: the ones the push service says are gone are
   * forgotten; why the others failed is kept on them and logged (a push
   * that works clears it). How many it reached, and the failures.
   */
  private async toDevices(devices: { id: string; endpoint: string; p256dh: string; auth: string }[], payload: PushPayload, config: PushConfig, webUrl: string): Promise<{ sent: number; errors: string[] }> {
    const subject = pushSubject(config, webUrl);
    let sent = 0;
    const errors: string[] = [];
    for (const device of devices) {
      const outcome = await sendPush(device, payload, config, subject);
      if (outcome.result === "gone") await this.prisma.client.pushSubscription.deleteMany({ where: { id: device.id } });
      if (outcome.result === "sent") {
        sent += 1;
        await this.prisma.client.pushSubscription.update({ where: { id: device.id }, data: { lastPushedAt: new Date(), lastError: null, lastErrorAt: null } });
      }
      if (outcome.result === "failed") {
        errors.push(outcome.error);
        this.logger.warn(`Push to device ${device.id} failed: ${outcome.error}`);
        await this.prisma.client.pushSubscription.update({ where: { id: device.id }, data: { lastError: outcome.error, lastErrorAt: new Date() } });
      }
    }
    return { sent, errors };
  }

  private async test(job: TestPushJob): Promise<number> {
    const { config, error } = await getPushConfigOrError();
    if (!config) throw new Error(error ?? "Push isn't set up");
    const user = await this.prisma.client.user.findUnique({ where: { id: job.userId }, select: { locale: true } });
    const devices = await this.prisma.client.pushSubscription.findMany({ where: { userId: job.userId } });
    const messages = MESSAGES[user?.locale ?? "en"] ?? en;
    const { sent, errors } = await this.toDevices(devices, { title: messages.notifications.testTitle, body: messages.notifications.testBody, url: "/dashboard#notifications", tag: "test" }, config, job.webUrl);
    // Reaching no device is a failure Admin > Background jobs shows, with why.
    if (sent === 0 && errors.length > 0) throw new Error(`The test push reached no device: ${errors.join("; ")}`);
    return sent;
  }
}
