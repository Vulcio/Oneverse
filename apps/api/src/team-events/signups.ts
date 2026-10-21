import { signedUpPeople } from "@oneverse/core";
import type { PrismaService } from "../prisma/prisma.service.js";
import { dateText, day } from "./team-events.service.js";

type Client = PrismaService["client"];

/** An event date's key in the maps below. */
export const signupKey = (eventId: string, date: string) => `${eventId}|${date}`;

/**
 * Who signed up for each of these event dates (issue #235): the people
 * scheduled on it once it has a line-up, else those who answered Available
 * (signedUpPeople in @oneverse/core). The one rule for the sidebar, the
 * calendar link, the reminders and the notifications.
 */
export async function signedUpFor(prisma: Client, dates: { eventId: string; date: string }[]): Promise<Map<string, string[]>> {
  const unique = [...new Map(dates.map((one) => [signupKey(one.eventId, one.date), one])).values()];
  const out = new Map<string, string[]>();
  if (unique.length === 0) return out;
  const where = { OR: unique.map((one) => ({ eventId: one.eventId, date: day(one.date) })) };
  const [answers, lineup] = await Promise.all([
    prisma.teamEventAnswer.findMany({ where, select: { eventId: true, date: true, userId: true, answer: true } }),
    // Guests without an account (no userId) fill a part, but aren't anyone to tell.
    prisma.teamEventAssignment.findMany({ where: { ...where, userId: { not: null } }, select: { eventId: true, date: true, userId: true, status: true } }),
  ]);
  for (const one of unique) {
    const key = signupKey(one.eventId, one.date);
    const matches = <T extends { eventId: string; date: Date }>(row: T) => row.eventId === one.eventId && dateText(row.date) === one.date;
    out.set(key, signedUpPeople(answers.filter(matches), lineup.filter(matches).map((row) => ({ ...row, userId: row.userId! }))));
  }
  return out;
}
