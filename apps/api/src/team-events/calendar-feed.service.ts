import { Injectable, NotFoundException } from "@nestjs/common";
import { addDays, eventDatePath, calendarFeed, callAt, eventDates, localDate, localTime, type CalendarFeedEntry } from "@oneverse/core";
import en from "@oneverse/core/i18n/locales/en";
import fr from "@oneverse/core/i18n/locales/fr";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { signedUpFor, signupKey } from "./signups.js";
import { changesOf, dateText, rehearsalDatesOf, timingOf, withDates } from "./team-events.service.js";

/** How far back and ahead a feed lists the dates signed up for. */
const BACK_DAYS = 90;
const AHEAD_DAYS = 366;

const apiUrl = () => (process.env.AUTH_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const webUrl = () => (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/** A date's call time (issue #240), in the reader's words: "Call 09:15"; null without one. */
function callLine(startsAt: string, minutes: number | null, timeZone: string, locale: string): string | null {
  const at = callAt(startsAt, minutes);
  return at ? (locale === "fr" ? fr : en).teamCalendar.callAt.replace("{{time}}", localTime(at, timeZone)) : null;
}

/**
 * Someone's calendar link (issue #235): an iCalendar feed, opened without
 * signing in by the long random token in its address, of the dates they
 * signed up for (answered Available) - from three months back to a year
 * ahead, cancelled dates left out - each with its team, place and set.
 * Resetting the link makes a new token; the old address stops working.
 */
const withVenue = { location: { select: { address: true, home: true } } } as const;

/** Where a date is, for a calendar app (issue #563): its rooms, its place, and its venue's address - not a home's, in a link anyone may have. */
function feedLocation(event: { place: string | null; rooms: { name: string }[]; location: { address: string | null; home: boolean } | null }, personal: boolean): string | null {
  const address = event.location?.address && (personal || !event.location.home) ? event.location.address : null;
  const where = [...event.rooms.map((room) => room.name), event.place].filter(Boolean).join(", ");
  return [where, address && address !== event.place ? address : null].filter(Boolean).join(" - ") || null;
}

@Injectable()
export class CalendarFeedService {
  constructor(private readonly prisma: PrismaService) {}

  private address(token: string) {
    return { url: `${apiUrl()}/calendar/${token}.ics` };
  }

  /** A team's link (issue #240), for its members (issue #551): null when it's off. */
  async team(teamId: string) {
    const feed = await this.prisma.client.calendarFeed.findUnique({ where: { teamId } });
    return feed ? this.address(feed.token) : { url: null };
  }

  /** A new team link, in the words of the admin making it; the old one stops working. */
  async resetTeam(teamId: string, userId: string) {
    const locale = (await this.prisma.client.user.findUnique({ where: { id: userId }, select: { locale: true } }))?.locale ?? "en";
    const token = randomBytes(32).toString("base64url");
    await this.prisma.client.calendarFeed.upsert({ where: { teamId }, create: { teamId, token, locale }, update: { token, locale, createdAt: new Date() } });
    return this.address(token);
  }

  async turnOffTeam(teamId: string): Promise<void> {
    await this.prisma.client.calendarFeed.deleteMany({ where: { teamId } });
  }

  /** An organisation's link (issue #551), for its members: null when it's off. */
  async organization(organizationId: string) {
    const feed = await this.prisma.client.calendarFeed.findUnique({ where: { organizationId } });
    return feed ? this.address(feed.token) : { url: null };
  }

  /** A new organisation link, in the words of the admin making it; the old one stops working. */
  async resetOrganization(organizationId: string, userId: string) {
    const locale = (await this.prisma.client.user.findUnique({ where: { id: userId }, select: { locale: true } }))?.locale ?? "en";
    const token = randomBytes(32).toString("base64url");
    await this.prisma.client.calendarFeed.upsert({ where: { organizationId }, create: { organizationId, token, locale }, update: { token, locale, createdAt: new Date() } });
    return this.address(token);
  }

  async turnOffOrganization(organizationId: string): Promise<void> {
    await this.prisma.client.calendarFeed.deleteMany({ where: { organizationId } });
  }

  /** The link, or null when it's off. */
  async mine(userId: string) {
    const feed = await this.prisma.client.calendarFeed.findUnique({ where: { userId } });
    return feed ? this.address(feed.token) : { url: null };
  }

  /** A new link: made, or reset (the old one stops working). */
  async reset(userId: string) {
    const token = randomBytes(32).toString("base64url");
    await this.prisma.client.calendarFeed.upsert({ where: { userId }, create: { userId, token }, update: { token, createdAt: new Date() } });
    return this.address(token);
  }

  async turnOff(userId: string): Promise<void> {
    await this.prisma.client.calendarFeed.deleteMany({ where: { userId } });
  }

  /** The feed for a token, and its ETag; NotFound for a token that isn't one (any more). */
  async feed(token: string): Promise<{ body: string; etag: string }> {
    const feed = await this.prisma.client.calendarFeed.findUnique({ where: { token }, include: { user: { select: { id: true, displayName: true, locale: true } }, team: { select: { id: true, name: true } }, organization: { select: { id: true, name: true } } } });
    if (!feed || !(feed.user || feed.team || feed.organization)) throw new NotFoundException("This calendar link doesn't work any more.");
    const today = new Date().toISOString().slice(0, 10);
    const from = addDays(today, -BACK_DAYS);
    const to = addDays(today, AHEAD_DAYS);
    const entries = feed.team
      ? await this.teamEntries(feed.team.id, from, to, feed.locale ?? "en")
      : feed.organization
        ? await this.organizationEntries(feed.organization.id, from, to, feed.locale ?? "en")
        : await this.personalEntries(feed.user!.id, from, to, feed.user!.locale);
    entries.sort((a, b) => a.start.localeCompare(b.start));
    const name = `Songverse - ${feed.team?.name ?? feed.organization?.name ?? feed.user!.displayName}`;
    const body = calendarFeed(entries, { name, now: new Date(`${localDate(new Date(), "UTC")}T00:00:00Z`).toISOString() });
    return { body, etag: `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"` };
  }

  /**
   * A team's dates (issue #240): every event's and rehearsal's, cancelled
   * ones left out, each with its call time, place, note and set - nobody's
   * answers or line-up.
   */
  private async teamEntries(teamId: string, from: string, to: string, locale: string): Promise<CalendarFeedEntry[]> {
    const events = await this.prisma.client.teamEvent.findMany({ where: { teamId }, include: { ...withDates, ...withVenue, team: { select: { name: true } } } });
    const entries: CalendarFeedEntry[] = [];
    for (const event of events) {
      const parent = event.rehearsalForId ? events.find((one) => one.id === event.rehearsalForId) : null;
      if (event.rehearsalForId && !parent) continue;
      const dates = parent ? rehearsalDatesOf(event, parent, from, to) : eventDates(timingOf(event), from, to, changesOf(event)).map((date) => ({ ...date, forDate: date.date }));
      for (const date of dates) {
        if (date.cancelled) continue;
        const setlistId = (parent ?? event).dates.find((row) => dateText(row.date) === date.forDate)?.setlist?.id;
        const setUrl = setlistId ? `${webUrl()}/sets/${setlistId}` : null;
        entries.push({
          uid: `${event.id}-${date.date}@songverse`,
          start: date.startsAt,
          end: date.endsAt,
          title: date.title || event.title,
          location: feedLocation(event, false),
          description: [callLine(date.startsAt, event.callMinutes, event.timeZone, locale), event.note, setUrl].filter(Boolean).join("\n"),
          // Its page (issue #575): when, where, the line-up and the set.
          url: `${webUrl()}${eventDatePath(event.id, date.date)}`,
        });
      }
    }
    return entries;
  }

  /**
   * An organisation's dates (issue #551): each of its events' once, however
   * many groups it needs, cancelled ones left out - nobody's answers.
   */
  private async organizationEntries(organizationId: string, from: string, to: string, locale: string): Promise<CalendarFeedEntry[]> {
    const events = await this.prisma.client.organizationEvent.findMany({ where: { organizationId }, select: { id: true, teamEvents: { include: { ...withDates, ...withVenue }, orderBy: { createdAt: "asc" } } } });
    const entries: CalendarFeedEntry[] = [];
    for (const { id, teamEvents } of events) {
      const [first] = teamEvents;
      if (!first) continue;
      // Every group's part has the same dates; a date is gone only when every group's is cancelled.
      const parts = teamEvents.map((part) => eventDates(timingOf(part), from, to, changesOf(part)));
      for (const date of parts[0]!) {
        if (parts.every((dates) => dates.find((one) => one.date === date.date)?.cancelled !== false)) continue;
        const setlistId = teamEvents.map((part) => part.dates.find((row) => dateText(row.date) === date.date)?.setlist?.id).find(Boolean);
        entries.push({
          uid: `${id}-${date.date}@songverse`,
          start: date.startsAt,
          end: date.endsAt,
          title: date.title || first.title,
          location: feedLocation(first, false),
          description: [callLine(date.startsAt, first.callMinutes, first.timeZone, locale), first.note, setlistId ? `${webUrl()}/sets/${setlistId}` : null].filter(Boolean).join("\n"),
          url: `${webUrl()}${eventDatePath(first.id, date.date)}`,
        });
      }
    }
    return entries;
  }

  /** The dates someone signed up for, and their rehearsals. */
  private async personalEntries(userId: string, from: string, to: string, locale: string): Promise<CalendarFeedEntry[]> {
    // The dates they might have signed up for - answered Available, or scheduled on - then the rule (signedUpFor).
    const range = { userId, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } };
    const [available, scheduled] = await Promise.all([
      this.prisma.client.teamEventAnswer.findMany({ where: { ...range, answer: "AVAILABLE", event: { team: { memberships: { some: { userId } } } } }, select: { eventId: true, date: true } }),
      this.prisma.client.teamEventAssignment.findMany({ where: { ...range, status: { not: "DECLINED" } }, select: { eventId: true, date: true } }),
    ]);
    const signedUp = await signedUpFor(this.prisma.client, [...available, ...scheduled].map((row) => ({ eventId: row.eventId, date: dateText(row.date) })));
    const answers = [...new Map([...available, ...scheduled].map((row) => [signupKey(row.eventId, dateText(row.date)), row])).values()].filter((row) =>
      signedUp.get(signupKey(row.eventId, dateText(row.date)))?.includes(userId),
    );
    const events = await this.prisma.client.teamEvent.findMany({
      where: { id: { in: [...new Set(answers.map((answer) => answer.eventId))] } },
      include: { ...withDates, ...withVenue, team: { select: { name: true } } },
    });
    const entries: CalendarFeedEntry[] = [];
    for (const answer of answers) {
      const event = events.find((one) => one.id === answer.eventId);
      if (!event) continue;
      const day = dateText(answer.date);
      const [date] = eventDates(timingOf(event), day, day, changesOf(event));
      if (!date || date.cancelled) continue;
      const setlistId = event.dates.find((row) => dateText(row.date) === day)?.setlist?.id;
      const setUrl = setlistId ? `${webUrl()}/sets/${setlistId}` : null;
      entries.push({
        uid: `${event.id}-${day}@songverse`,
        start: date.startsAt,
        end: date.endsAt,
        title: `${date.title || event.title} (${event.team.name})`,
        location: feedLocation(event, true),
        description: [callLine(date.startsAt, event.callMinutes, event.timeZone, locale), event.team.name, event.note, setUrl].filter(Boolean).join("\n"),
        url: `${webUrl()}${eventDatePath(event.id, day)}`,
      });
    }
    // The rehearsals of the dates they signed up for (issue #235, phase 7).
    const rehearsals = await this.prisma.client.teamEvent.findMany({ where: { rehearsalForId: { in: events.map((event) => event.id) } }, include: { ...withDates, ...withVenue, team: { select: { name: true } } } });
    for (const rehearsal of rehearsals) {
      const parent = events.find((one) => one.id === rehearsal.rehearsalForId)!;
      const theirs = new Set(answers.filter((answer) => answer.eventId === parent.id).map((answer) => dateText(answer.date)));
      for (const date of rehearsalDatesOf(rehearsal, parent, addDays(from, -14), to)) {
        if (date.cancelled || !theirs.has(date.forDate)) continue;
        const setlistId = parent.dates.find((row) => dateText(row.date) === date.forDate)?.setlist?.id;
        const setUrl = setlistId ? `${webUrl()}/sets/${setlistId}` : null;
        entries.push({
          uid: `${rehearsal.id}-${date.date}@songverse`,
          start: date.startsAt,
          end: date.endsAt,
          title: `${rehearsal.title} (${rehearsal.team.name})`,
          location: feedLocation(rehearsal, true),
          description: [callLine(date.startsAt, rehearsal.callMinutes, rehearsal.timeZone, locale), rehearsal.team.name, rehearsal.note, setUrl].filter(Boolean).join("\n"),
          url: `${webUrl()}${eventDatePath(rehearsal.id, date.date)}`,
        });
      }
    }
    return entries;
  }
}
