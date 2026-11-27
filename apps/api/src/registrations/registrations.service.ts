import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import {
  addDays,
  answersProblem,
  eventDates,
  localDate,
  placesCount,
  placesFit,
  placesKept,
  placesLeftOf,
  placesProblem,
  placesTaken,
  priceOf,
  promotions,
  registrationOpensAt,
  registrationState,
  wherePlace,
  type EventDate,
  type EventTiming,
  type MyRegistration,
  type PlaceKind,
  type Places,
  type PublicRegistrationPage,
  type RegistrationAnswers,
  type RegistrationDate,
  type RegistrationEntry,
  type RegistrationForm as RegistrationFormView,
  type RegistrationEmailKind,
  type RegistrationList,
  type RegistrationQuestion,
  type RegistrationStatus,
} from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import type { Queue } from "bullmq";
import { randomBytes } from "node:crypto";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { oneverseUrl, songverseUrl } from "../common/utils/web-apps.js";
import { REGISTRATIONS_QUEUE } from "../jobs/jobs.constants.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { managesRegistrationsByRole } from "../roles/capabilities.js";
import { changesOf, dateText, day, timingOf, withDates } from "../team-events/team-events.service.js";
import type { ManageRegistrationDto, RegisterDto, RegistrationFormDto, UpdateRegistrationDto } from "./dto/registrations.dto.js";

type Viewer = Pick<AuthenticatedUser, "id" | "isGlobalAdmin">;

/** An email about a registration, put into words by the registrations' job. */
export interface RegistrationEmailJob {
  registrationId: string;
  kind: RegistrationEmailKind;
}

/** How far ahead the public page lists dates, and how many. */
const PAGE_DAYS_AHEAD = 400;
const PAGE_DATES_MAX = 20;

const withEvents = {
  teamEvent: { include: { ...withDates, team: { select: { name: true, organizationId: true } }, location: { select: { name: true, address: true, home: true } } } },
  organizationEvent: {
    include: {
      organization: { select: { name: true } },
      location: { select: { name: true, address: true, home: true } },
      rooms: { select: { name: true }, orderBy: { name: "asc" } },
      teamEvents: { include: withDates, orderBy: { createdAt: "asc" }, take: 1 },
    },
  },
} as const;
type FormRow = Prisma.RegistrationFormGetPayload<{ include: typeof withEvents }>;
type RegistrationRow = Prisma.RegistrationGetPayload<object>;

/** The event a form is for, as registration needs it. */
interface EventOf {
  title: string;
  organizer: string;
  place: string | null;
  timeZone: string;
  timing: EventTiming;
  changes: ReturnType<typeof changesOf>;
  scope: { teamId: string } | { organizationId: string };
  /** An organisation's event's organiser. */
  organiserId: string | null;
}

/** Where people see a place: its rooms and venue, a home's address left out. */
function placeText(place: string | null, location: { name: string; address: string | null; home: boolean } | null, rooms: { name: string }[]): string | null {
  const venue = location ? (location.home || !location.address ? location.name : `${location.name}, ${location.address}`) : null;
  return wherePlace(place || venue, rooms.map((room) => room.name));
}

function eventOf(form: FormRow): EventOf {
  if (form.teamEvent) {
    const event = form.teamEvent;
    return {
      title: event.title,
      organizer: event.team.name,
      place: placeText(event.place, event.location, event.rooms),
      timeZone: event.timeZone,
      timing: timingOf(event),
      changes: changesOf(event),
      scope: { teamId: event.teamId },
      organiserId: null,
    };
  }
  const event = form.organizationEvent!;
  // Its groups' parts share its timing, and keep its dates' moves and changes (issue #576).
  const group = event.teamEvents[0];
  const timing: EventTiming = group
    ? timingOf(group)
    : {
        date: dateText(event.date),
        startTime: event.startTime,
        durationMinutes: event.durationMinutes,
        timeZone: event.timeZone,
        repeat: event.repeatEveryWeeks ? { everyWeeks: event.repeatEveryWeeks, until: event.repeatUntil ? dateText(event.repeatUntil) : null } : null,
      };
  return {
    title: event.title,
    organizer: event.organization.name,
    place: placeText(event.place, event.location, event.rooms),
    timeZone: event.timeZone,
    timing,
    changes: group ? changesOf(group) : [],
    scope: { organizationId: event.organizationId },
    organiserId: event.hostUserId,
  };
}

const json = <T>(value: Prisma.JsonValue, fallback: T): T => (value === null || value === undefined ? fallback : (value as unknown as T));
const kindsOf = (form: { placeKinds: Prisma.JsonValue }) => json<PlaceKind[]>(form.placeKinds, []);
const questionsOf = (form: { questions: Prisma.JsonValue }) => json<RegistrationQuestion[]>(form.questions, []);
const placesOf = (row: { places: Prisma.JsonValue }) => json<Places>(row.places, {});

/** A new id for a place kind or a question: short, unique in its form. */
function newId(taken: Set<string>): string {
  for (;;) {
    const id = randomBytes(4).toString("hex");
    if (!taken.has(id)) return id;
  }
}

/** The web app the public pages live in: Oneverse's, else Songverse's. */
function pagesUrl(): string {
  return oneverseUrl() ?? songverseUrl();
}

export function registrationPageUrl(publicId: string): string {
  return `${pagesUrl()}/register/${publicId}`;
}

export function registrationLink(token: string): string {
  return `${pagesUrl()}/registration/${token}`;
}

/**
 * Registration for event dates (issue #593): an event's form - places by
 * kind, questions, a waiting list - set by its managers (the team's or the
 * organisation's admins, the organiser, and whoever a role lets), and the
 * registrations for each date, made on the public page with or without an
 * account and changed from the link in their emails. Places are counted
 * under a lock per date, so two people never take the last one.
 */
@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    @InjectQueue(REGISTRATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  private async loadForm(where: Prisma.RegistrationFormWhereUniqueInput): Promise<FormRow | null> {
    return this.prisma.client.registrationForm.findUnique({ where, include: withEvents });
  }

  /** A team's admins (or its organisation's), an organisation's admins, its event's organiser, or a role's holders. */
  private async canManage(viewer: Viewer, event: Pick<EventOf, "scope" | "organiserId">): Promise<boolean> {
    if (viewer.isGlobalAdmin) return true;
    if ("teamId" in event.scope) {
      if ((await this.access.teamRole(viewer.id, event.scope.teamId)) === "ADMIN") return true;
      const team = await this.prisma.client.team.findUnique({ where: { id: event.scope.teamId }, select: { organizationId: true } });
      if (team?.organizationId && (await this.organizationRole(viewer.id, team.organizationId)) === "ADMIN") return true;
    } else {
      if (event.organiserId === viewer.id) return true;
      if ((await this.organizationRole(viewer.id, event.scope.organizationId)) === "ADMIN") return true;
    }
    return managesRegistrationsByRole(this.prisma.client, viewer.id, event.scope);
  }

  private async organizationRole(userId: string, organizationId: string) {
    return (await this.prisma.client.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { role: true } }))?.role ?? null;
  }

  /** Whether the viewer sees the event at all: a member of its team, or of its organisation or one of its groups. */
  private async sees(viewer: Viewer, scope: EventOf["scope"]): Promise<boolean> {
    if (viewer.isGlobalAdmin) return true;
    if ("teamId" in scope) return (await this.access.teamRole(viewer.id, scope.teamId)) !== null;
    if (await this.organizationRole(viewer.id, scope.organizationId)) return true;
    return !!(await this.prisma.client.teamMembership.findFirst({ where: { userId: viewer.id, team: { organizationId: scope.organizationId } }, select: { userId: true } }));
  }

  /** The event a form would be for, from its ids, with what's needed to check who manages it. */
  private async eventFor(target: { teamEventId?: string; organizationEventId?: string }): Promise<Pick<EventOf, "scope" | "organiserId">> {
    if (target.teamEventId) {
      const event = await this.prisma.client.teamEvent.findUnique({ where: { id: target.teamEventId }, select: { teamId: true, organizationEventId: true, rehearsalForId: true } });
      if (!event) throw new NotFoundException("Event not found");
      // A group's part of an organisation's event: registration is the organisation's event's.
      if (event.organizationEventId) throw new BadRequestException(["This event is part of its organisation's: registration is set on the organisation's event"]);
      if (event.rehearsalForId) throw new BadRequestException(["A rehearsal takes no registrations"]);
      return { scope: { teamId: event.teamId }, organiserId: null };
    }
    const event = await this.prisma.client.organizationEvent.findUnique({ where: { id: target.organizationEventId! }, select: { organizationId: true, hostUserId: true } });
    if (!event) throw new NotFoundException("Event not found");
    return { scope: { organizationId: event.organizationId }, organiserId: event.hostUserId };
  }

  private view(form: FormRow | Prisma.RegistrationFormGetPayload<object>): RegistrationFormView {
    return {
      id: form.id,
      teamEventId: form.teamEventId,
      organizationEventId: form.organizationEventId,
      publicId: form.publicId,
      publicUrl: registrationPageUrl(form.publicId),
      open: form.open,
      opensDaysBefore: form.opensDaysBefore,
      closesHoursBefore: form.closesHoursBefore,
      limit: form.limit,
      placeKinds: kindsOf(form),
      currency: form.currency,
      questions: questionsOf(form),
      waitingList: form.waitingList,
      intro: form.intro,
    };
  }

  /** GET /registration-forms: an event's registration, for those who see the event. */
  async get(viewer: Viewer, target: { teamEventId?: string; organizationEventId?: string }) {
    // A group's part of an organisation's event shows the organisation's event's.
    let organizationEventId = target.organizationEventId;
    if (target.teamEventId) {
      const part = await this.prisma.client.teamEvent.findUnique({ where: { id: target.teamEventId }, select: { organizationEventId: true } });
      if (part?.organizationEventId) organizationEventId = part.organizationEventId;
    }
    const lookup = organizationEventId ? { organizationEventId } : { teamEventId: target.teamEventId! };
    const event = await this.eventFor(lookup);
    if (!(await this.sees(viewer, event.scope))) throw new NotFoundException("Event not found");
    const form = await this.loadForm(lookup);
    return { form: form ? this.view(form) : null, canManage: await this.canManage(viewer, event), organizationEventId: organizationEventId ?? null };
  }

  private async assertManager(viewer: Viewer, event: Pick<EventOf, "scope" | "organiserId">) {
    if (!(await this.canManage(viewer, event))) throw new ForbiddenException("Only those who manage this event's registrations do this");
  }

  /** PUT /registration-forms: turns registration on, or changes it; place kinds and questions keep their ids. */
  async save(viewer: Viewer, dto: RegistrationFormDto): Promise<RegistrationFormView> {
    const event = await this.eventFor(dto);
    await this.assertManager(viewer, event);
    const where = dto.teamEventId ? { teamEventId: dto.teamEventId } : { organizationEventId: dto.organizationEventId! };
    const kindIds = new Set(dto.placeKinds.flatMap((kind) => (kind.id ? [kind.id] : [])));
    const questionIds = new Set(dto.questions.flatMap((question) => (question.id ? [question.id] : [])));
    if (kindIds.size !== dto.placeKinds.filter((kind) => kind.id).length || questionIds.size !== dto.questions.filter((question) => question.id).length) throw new BadRequestException(["Place kinds and questions must have different ids"]);
    const placeKinds: PlaceKind[] = dto.placeKinds.map((kind) => {
      const id = kind.id ?? newId(kindIds);
      kindIds.add(id);
      return { id, name: kind.name, limit: kind.limit ?? null, price: kind.price ?? null };
    });
    const questions: RegistrationQuestion[] = dto.questions.map((question) => {
      const id = question.id ?? newId(questionIds);
      questionIds.add(id);
      return { id, label: question.label, type: question.type, ...(question.type === "choice" ? { options: question.options ?? [] } : {}), required: question.required };
    });
    if (placeKinds.some((kind) => kind.price !== null) && !dto.currency) throw new BadRequestException(["currency must be given when a place kind has a price"]);
    const data = {
      open: dto.open,
      opensDaysBefore: dto.opensDaysBefore ?? null,
      closesHoursBefore: dto.closesHoursBefore,
      limit: dto.limit ?? null,
      placeKinds: placeKinds as unknown as Prisma.InputJsonValue,
      currency: dto.currency ?? null,
      questions: questions as unknown as Prisma.InputJsonValue,
      waitingList: dto.waitingList,
      intro: dto.intro ?? null,
    };
    const form = await this.prisma.client.registrationForm.upsert({ where, update: data, create: { ...where, ...data, publicId: randomBytes(9).toString("base64url") } });
    return this.view(form);
  }

  /** DELETE /registration-forms/:id: registration off, its registrations gone. */
  async remove(viewer: Viewer, formId: string): Promise<void> {
    const form = await this.loadForm({ id: formId });
    if (!form) throw new NotFoundException("Registration not found");
    await this.assertManager(viewer, eventOf(form));
    await this.prisma.client.registrationForm.delete({ where: { id: formId } });
  }

  /** A date of the form's event, as it is (moved, another time), or null when it has none that day or it's cancelled. */
  private dateOf(event: EventOf, date: string): EventDate | null {
    const [found] = eventDates(event.timing, date, date, event.changes);
    return found && found.date === date && !found.cancelled ? found : null;
  }

  /** A date as the public pages show it: without the places taken or how many wait. */
  private shown(form: FormRow, date: EventDate, rows: { places: Prisma.JsonValue; status: string }[], now = new Date()): PublicRegistrationPage["dates"][number] {
    const { date: day, startsAt, endsAt, state, opensAt, left } = this.summary(form, date, rows, now);
    return { date: day, startsAt, endsAt, state, opensAt, left };
  }

  private summary(form: FormRow, date: EventDate, rows: { places: Prisma.JsonValue; status: string }[], now = new Date()): RegistrationDate {
    const limits = { limit: form.limit, placeKinds: kindsOf(form) };
    const taken = placesTaken(rows.map((row) => ({ places: placesOf(row), status: row.status })));
    const state = registrationState(form, date.startsAt, now);
    return {
      date: date.date,
      startsAt: date.startsAt,
      endsAt: date.endsAt,
      state,
      opensAt: state === "notYet" ? registrationOpensAt(form, date.startsAt) : null,
      taken,
      left: placesLeftOf(limits, taken),
      waiting: rows.filter((row) => row.status === "WAITING").length,
    };
  }

  private entry(form: FormRow, row: RegistrationRow): RegistrationEntry {
    return {
      id: row.id,
      date: dateText(row.date),
      name: row.name,
      email: row.email,
      member: !!row.userId,
      places: placesOf(row),
      count: row.count,
      answers: json<RegistrationAnswers>(row.answers, {}),
      status: row.status as RegistrationStatus,
      paid: !!row.paidAt,
      price: priceOf(kindsOf(form), placesOf(row)),
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** GET /registration-forms/:id/dates/:date: who registered, in the order they did. */
  async list(viewer: Viewer, formId: string, date: string): Promise<RegistrationList> {
    const form = await this.loadForm({ id: formId });
    if (!form) throw new NotFoundException("Registration not found");
    const event = eventOf(form);
    await this.assertManager(viewer, event);
    const found = this.dateOf(event, date);
    if (!found) throw new NotFoundException("The event has no date then");
    const rows = await this.prisma.client.registration.findMany({ where: { formId, date: day(date) }, orderBy: { createdAt: "asc" } });
    return { form: this.view(form), date: this.summary(form, found, rows), registrations: rows.map((row) => this.entry(form, row)) };
  }

  /** The list as CSV: one row per registration, a column per place kind and per question. */
  async csv(viewer: Viewer, formId: string, date: string): Promise<string> {
    const { form, registrations } = await this.list(viewer, formId, date);
    const cell = (value: unknown) => {
      const text = value === null || value === undefined ? "" : String(value);
      // A cell a spreadsheet would run as a formula is kept as text.
      const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const header = ["Name", "Email", "Status", ...form.placeKinds.map((kind) => kind.name), "Places", "Price", "Paid", ...form.questions.map((question) => question.label), "Registered"];
    const lines = registrations.map((one) => [
      one.name,
      one.email,
      one.status,
      ...form.placeKinds.map((kind) => one.places[kind.id] ?? 0),
      one.count,
      one.price === null ? "" : (one.price / 100).toFixed(2),
      one.paid ? "yes" : "no",
      ...form.questions.map((question) => {
        const value = one.answers[question.id];
        return typeof value === "boolean" ? (value ? "yes" : "no") : value;
      }),
      one.createdAt,
    ]);
    return [header, ...lines].map((line) => line.map(cell).join(",")).join("\r\n") + "\r\n";
  }

  /** PATCH /registrations/:id: its managers mark it paid (or not), or cancel it. */
  async manage(viewer: Viewer, registrationId: string, dto: ManageRegistrationDto): Promise<RegistrationEntry> {
    const row = await this.prisma.client.registration.findUnique({ where: { id: registrationId } });
    if (!row) throw new NotFoundException("Registration not found");
    const form = (await this.loadForm({ id: row.formId }))!;
    await this.assertManager(viewer, eventOf(form));
    if (dto.paid !== undefined) await this.prisma.client.registration.update({ where: { id: row.id }, data: { paidAt: dto.paid ? (row.paidAt ?? new Date()) : null } });
    if (dto.cancelled && row.status !== "CANCELLED") await this.cancel(form, row);
    return this.entry(form, (await this.prisma.client.registration.findUnique({ where: { id: row.id } }))!);
  }

  /** Runs `work` alone among the changes to one date's registrations. */
  private async locked<T>(formId: string, date: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`registration:${formId}:${date}`}))`;
      return work(tx);
    });
  }

  /** Waiting registrations that now fit, confirmed (inside the date's lock). */
  private async promote(tx: Prisma.TransactionClient, form: FormRow, date: string): Promise<string[]> {
    const rows = await tx.registration.findMany({ where: { formId: form.id, date: day(date), status: { in: ["CONFIRMED", "WAITING"] } }, orderBy: { createdAt: "asc" } });
    const chosen = promotions(
      { limit: form.limit, placeKinds: kindsOf(form) },
      rows.filter((row) => row.status === "CONFIRMED").map((row) => ({ places: placesOf(row) })),
      rows.filter((row) => row.status === "WAITING").map((row) => ({ id: row.id, places: placesOf(row) })),
    );
    if (chosen.length) await tx.registration.updateMany({ where: { id: { in: chosen } }, data: { status: "CONFIRMED" } });
    return chosen;
  }

  private async cancel(form: FormRow, row: RegistrationRow): Promise<void> {
    const date = dateText(row.date);
    const promoted = await this.locked(form.id, date, async (tx) => {
      await tx.registration.update({ where: { id: row.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      return this.promote(tx, form, date);
    });
    await this.email(row.id, "cancelled");
    for (const id of promoted) await this.email(id, "promoted");
  }

  private async email(registrationId: string, kind: RegistrationEmailKind): Promise<void> {
    await this.queue.add("email", { registrationId, kind } satisfies RegistrationEmailJob, { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 100, removeOnFail: 200 });
  }

  /** GET /public/registrations/:publicId: the event, its form and its coming dates, for anyone with the link. */
  async page(publicId: string, now = new Date()): Promise<PublicRegistrationPage> {
    const form = await this.loadForm({ publicId });
    if (!form) throw new NotFoundException("Registration not found");
    const event = eventOf(form);
    const today = localDate(now, event.timeZone);
    const dates = eventDates(event.timing, today, addDays(today, PAGE_DAYS_AHEAD), event.changes)
      .filter((one) => !one.cancelled && new Date(one.startsAt) > now)
      .slice(0, PAGE_DATES_MAX);
    const rows = await this.prisma.client.registration.findMany({ where: { formId: form.id, date: { in: dates.map((one) => day(one.date)) }, status: "CONFIRMED" }, select: { date: true, places: true, status: true } });
    return {
      ...this.pageHead(form, event),
      dates: dates.map((one) => this.shown(form, one, rows.filter((row) => dateText(row.date) === one.date), now)),
    };
  }

  private pageHead(form: FormRow, event: EventOf): Omit<PublicRegistrationPage, "dates"> {
    return {
      publicId: form.publicId,
      title: event.title,
      organizer: event.organizer,
      place: event.place,
      timeZone: event.timeZone,
      intro: form.intro,
      placeKinds: kindsOf(form),
      currency: form.currency,
      questions: questionsOf(form),
      waitingList: form.waitingList,
    };
  }

  private checked(form: FormRow, places: Places, answers: RegistrationAnswers): Places {
    const kept = placesKept(places);
    const problem = placesProblem(kindsOf(form), kept) ?? answersProblem(questionsOf(form), answers);
    if (problem) throw new BadRequestException([problem]);
    return kept;
  }

  /** POST /public/registrations/:publicId/:date: someone registers; a member signed in has it tied to their account. */
  async register(publicId: string, date: string, dto: RegisterDto, userId: string | null, now = new Date()): Promise<MyRegistration> {
    const form = await this.loadForm({ publicId });
    if (!form) throw new NotFoundException("Registration not found");
    const event = eventOf(form);
    const found = this.dateOf(event, date);
    if (!found) throw new NotFoundException("The event has no date then");
    const state = registrationState(form, found.startsAt, now);
    if (state !== "open") throw new ConflictException({ statusCode: 409, code: state === "notYet" ? "REGISTRATION_NOT_OPEN_YET" : "REGISTRATION_CLOSED", message: state === "notYet" ? "Registration for this date isn't open yet" : "Registration for this date is closed" });
    const places = this.checked(form, dto.places, dto.answers);
    const token = randomBytes(24).toString("base64url");
    const row = await this.locked(form.id, date, async (tx) => {
      const rows = await tx.registration.findMany({ where: { formId: form.id, date: day(date), status: "CONFIRMED" }, select: { places: true, status: true } });
      const taken = placesTaken(rows.map((one) => ({ places: placesOf(one), status: one.status })));
      // Others already wait: a newcomer waits behind them, even when it would fit.
      const waitingAhead = await tx.registration.count({ where: { formId: form.id, date: day(date), status: "WAITING" } });
      const fits = placesFit({ limit: form.limit, placeKinds: kindsOf(form) }, taken, places) && waitingAhead === 0;
      if (!fits && !form.waitingList) throw new ConflictException({ statusCode: 409, code: "REGISTRATION_FULL", message: "There aren't enough places left for this date" });
      return tx.registration.create({
        data: { formId: form.id, date: day(date), name: dto.name, email: dto.email, userId, places, count: placesCount(places), answers: dto.answers as Prisma.InputJsonValue, status: fits ? "CONFIRMED" : "WAITING", manageToken: token, locale: dto.locale },
      });
    });
    await this.email(row.id, row.status === "CONFIRMED" ? "confirmed" : "waiting");
    return { ...(await this.mine(row, form, now)), token };
  }

  private async byToken(token: string): Promise<{ row: RegistrationRow; form: FormRow }> {
    const row = await this.prisma.client.registration.findUnique({ where: { manageToken: token } });
    if (!row) throw new NotFoundException("Registration not found");
    return { row, form: (await this.loadForm({ id: row.formId }))! };
  }

  private async mine(row: RegistrationRow, form: FormRow, now = new Date()): Promise<MyRegistration> {
    const event = eventOf(form);
    const date = dateText(row.date);
    const found = this.dateOf(event, date);
    let shown: PublicRegistrationPage["dates"][number] | null = null;
    if (found) {
      const rows = await this.prisma.client.registration.findMany({ where: { formId: form.id, date: row.date, status: "CONFIRMED" }, select: { places: true, status: true } });
      shown = this.shown(form, found, rows, now);
    }
    return {
      date,
      name: row.name,
      email: row.email,
      places: placesOf(row),
      answers: json<RegistrationAnswers>(row.answers, {}),
      status: row.status as RegistrationStatus,
      paid: !!row.paidAt,
      price: priceOf(kindsOf(form), placesOf(row)),
      canChange: row.status !== "CANCELLED" && shown?.state === "open",
      page: { ...this.pageHead(form, event), date: shown },
    };
  }

  /** GET /public/registration/:token */
  async getMine(token: string): Promise<MyRegistration> {
    const { row, form } = await this.byToken(token);
    return this.mine(row, form);
  }

  /**
   * PATCH /public/registration/:token: other places or answers, while its
   * date's registration is open. A confirmed one that no longer fits is
   * refused rather than sent to wait; places given back go to those waiting.
   */
  async update(token: string, dto: UpdateRegistrationDto, now = new Date()): Promise<MyRegistration> {
    const { row, form } = await this.byToken(token);
    const date = dateText(row.date);
    const current = await this.mine(row, form, now);
    if (!current.canChange) throw new ConflictException({ statusCode: 409, code: "REGISTRATION_CLOSED", message: "This registration can't be changed any more" });
    const places = this.checked(form, dto.places ?? placesOf(row), dto.answers ?? current.answers);
    const promoted = await this.locked(form.id, date, async (tx) => {
      const fresh = (await tx.registration.findUnique({ where: { id: row.id } }))!;
      if (fresh.status === "CONFIRMED" && dto.places) {
        const others = await tx.registration.findMany({ where: { formId: form.id, date: row.date, status: "CONFIRMED", id: { not: row.id } }, select: { places: true, status: true } });
        const taken = placesTaken(others.map((one) => ({ places: placesOf(one), status: one.status })));
        if (!placesFit({ limit: form.limit, placeKinds: kindsOf(form) }, taken, places)) throw new ConflictException({ statusCode: 409, code: "REGISTRATION_FULL", message: "There aren't enough places left for this date" });
      }
      await tx.registration.update({
        where: { id: row.id },
        data: { ...(dto.name !== undefined && { name: dto.name }), places, count: placesCount(places), ...(dto.answers !== undefined && { answers: dto.answers as Prisma.InputJsonValue }) },
      });
      return this.promote(tx, form, date);
    });
    await this.email(row.id, "changed");
    for (const id of promoted) if (id !== row.id) await this.email(id, "promoted");
    const after = (await this.prisma.client.registration.findUnique({ where: { id: row.id } }))!;
    return this.mine(after, form, now);
  }

  /** POST /public/registration/:token/cancel: until its date starts. */
  async cancelMine(token: string, now = new Date()): Promise<MyRegistration> {
    const { row, form } = await this.byToken(token);
    if (row.status !== "CANCELLED") {
      const found = this.dateOf(eventOf(form), dateText(row.date));
      if (found && new Date(found.startsAt) <= now) throw new ConflictException({ statusCode: 409, code: "REGISTRATION_CLOSED", message: "This date has started: ask its organisers" });
      await this.cancel(form, row);
    }
    const after = (await this.prisma.client.registration.findUnique({ where: { id: row.id } }))!;
    return this.mine(after, form, now);
  }

  /** What an email about a registration needs: it, its event and its date. */
  async forEmail(registrationId: string) {
    const row = await this.prisma.client.registration.findUnique({ where: { id: registrationId } });
    if (!row) return null;
    const form = (await this.loadForm({ id: row.formId }))!;
    const event = eventOf(form);
    return { row, form, event, date: this.dateOf(event, dateText(row.date)), places: placesOf(row), placeKinds: kindsOf(form) };
  }

  /**
   * The confirmed registrations whose date starts within the next day and
   * that weren't reminded yet: each date's own start, in its event's time
   * zone (checked against the day before, the hour the job runs).
   */
  async remindersDue(now = new Date()): Promise<string[]> {
    const soon = new Date(now.getTime() + 36 * 3_600_000);
    const rows = await this.prisma.client.registration.findMany({
      where: { status: "CONFIRMED", remindedAt: null, date: { gte: day(addDays(dateText(now), -1)), lte: day(dateText(soon)) } },
      select: { id: true, formId: true, date: true },
    });
    const due: string[] = [];
    const forms = new Map<string, FormRow | null>();
    for (const row of rows) {
      if (!forms.has(row.formId)) forms.set(row.formId, await this.loadForm({ id: row.formId }));
      const form = forms.get(row.formId);
      if (!form) continue;
      const found = this.dateOf(eventOf(form), dateText(row.date));
      if (!found) continue;
      const startsIn = new Date(found.startsAt).getTime() - now.getTime();
      if (startsIn > 0 && startsIn <= 24 * 3_600_000) due.push(row.id);
    }
    return due;
  }
}
