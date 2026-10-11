import { Injectable, NotFoundException } from "@nestjs/common";
import { addDays, calendarFeed, eventDates, localDate, type CalendarFeedEntry } from "@songverse/core";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import { signedUpFor, signupKey } from "./signups.js";
import { changesOf, dateText, timingOf, withDates } from "./team-events.service.js";

/** How far back and ahead a feed lists the dates signed up for. */
const BACK_DAYS = 90;
const AHEAD_DAYS = 366;

const apiUrl = () => (process.env.AUTH_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const webUrl = () => (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/**
 * Someone's calendar link (issue #235): an iCalendar feed, opened without
 * signing in by the long random token in its address, of the dates they
 * signed up for (answered Available) - from three months back to a year
 * ahead, cancelled dates left out - each with its team, place and set.
 * Resetting the link makes a new token; the old address stops working.
 */
@Injectable()
export class CalendarFeedService {
  constructor(private readonly prisma: PrismaService) {}

  private address(token: string) {
    return { url: `${apiUrl()}/calendar/${token}.ics` };
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
    const feed = await this.prisma.client.calendarFeed.findUnique({ where: { token }, include: { user: { select: { id: true, displayName: true } } } });
    if (!feed) throw new NotFoundException("This calendar link doesn't work any more.");
    const userId = feed.user.id;
    const today = new Date().toISOString().slice(0, 10);
    const from = addDays(today, -BACK_DAYS);
    const to = addDays(today, AHEAD_DAYS);
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
      include: { ...withDates, team: { select: { name: true } } },
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
        location: event.place,
        description: [event.team.name, event.note, setUrl].filter(Boolean).join("\n"),
        url: setUrl,
      });
    }
    entries.sort((a, b) => a.start.localeCompare(b.start));
    const body = calendarFeed(entries, { name: `Songverse - ${feed.user.displayName}`, now: new Date(`${localDate(new Date(), "UTC")}T00:00:00Z`).toISOString() });
    return { body, etag: `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"` };
  }
}
