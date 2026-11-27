import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { registrationEmail, type Messages } from "@oneverse/core";
import en from "@oneverse/core/i18n/locales/en";
import fr from "@oneverse/core/i18n/locales/fr";
import type { Job, Queue } from "bullmq";
import { sendRegistrationEmail } from "../auth/email.js";
import { JOB_WORKER_OPTIONS, REGISTRATIONS_QUEUE } from "../jobs/jobs.constants.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { registrationLink, RegistrationsService, type RegistrationEmailJob } from "./registrations.service.js";

const MESSAGES: Record<string, Messages> = { en, fr };

/** The reminders due (issue #593): every hour, a day before each date starts. */
export const REGISTRATION_REMINDERS_SCHEDULER_ID = "registration-reminders";

/**
 * Emails about people's registrations (issue #593): confirmed, on the
 * waiting list, given a place, changed, cancelled - each to the address
 * they registered with, in their page's language, with their link - and,
 * every hour, the reminders a day before their date.
 */
@Processor(REGISTRATIONS_QUEUE, JOB_WORKER_OPTIONS)
export class RegistrationsProcessor extends WorkerHost {
  private readonly logger = new Logger(RegistrationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registrations: RegistrationsService,
  ) {
    super();
  }

  async process(job: Job<RegistrationEmailJob>): Promise<{ emailed: number }> {
    if (job.name === REGISTRATION_REMINDERS_SCHEDULER_ID) {
      let emailed = 0;
      for (const id of await this.registrations.remindersDue()) {
        // Marked first: a retried job never reminds twice.
        const { count } = await this.prisma.client.registration.updateMany({ where: { id, remindedAt: null }, data: { remindedAt: new Date() } });
        if (count && (await this.send({ registrationId: id, kind: "reminder" }))) emailed++;
      }
      if (emailed) this.logger.log(`Registrations: reminded ${emailed}`);
      return { emailed };
    }
    return { emailed: (await this.send(job.data)) ? 1 : 0 };
  }

  private async send(job: RegistrationEmailJob): Promise<boolean> {
    const found = await this.registrations.forEmail(job.registrationId);
    if (!found) return false;
    const { row, form, event, date } = found;
    const locale = MESSAGES[row.locale] ? row.locale : "en";
    const email = registrationEmail(
      job.kind,
      { name: row.name, event: event.title, organizer: event.organizer, startsAt: date?.startsAt ?? null, endsAt: date?.endsAt ?? null, timeZone: event.timeZone, place: event.place, places: found.places, placeKinds: found.placeKinds, currency: form.currency },
      MESSAGES[locale]!,
      locale,
    );
    await sendRegistrationEmail(row.email, { ...email, url: registrationLink(row.manageToken) });
    return true;
  }
}

/** Registers the reminders' schedule; upsertJobScheduler is idempotent. */
@Injectable()
export class RegistrationsScheduler implements OnModuleInit {
  constructor(@InjectQueue(REGISTRATIONS_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(REGISTRATION_REMINDERS_SCHEDULER_ID, { every: 60 * 60 * 1000 }, { name: REGISTRATION_REMINDERS_SCHEDULER_ID });
  }
}
