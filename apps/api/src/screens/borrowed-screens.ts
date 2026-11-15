import { Prisma } from "@oneverse/db";
import { redis } from "../jobs/redis.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { SCREEN_CHANNEL } from "./screen-channel.js";

/**
 * A screen borrowed for a set (issue #480): what it showed before, kept
 * while it shows the set it was borrowed for, and given back when its time
 * is up or sooner.
 */
export interface BorrowedFrom {
  setlistId: string | null;
  setMode: "FIXED" | "DAY" | "LOCATION";
  setByUserId: string | null;
  locationId: string | null;
  setlistPickedOn: string | null;
}

export function readBorrowedFrom(value: unknown): BorrowedFrom | null {
  if (!value || typeof value !== "object") return null;
  const from = value as Record<string, unknown>;
  const text = (key: string) => (typeof from[key] === "string" ? (from[key] as string) : null);
  const setMode = from.setMode === "DAY" || from.setMode === "LOCATION" ? from.setMode : "FIXED";
  return { setlistId: text("setlistId"), setMode, setByUserId: text("setByUserId"), locationId: text("locationId"), setlistPickedOn: text("setlistPickedOn") };
}

/** No longer borrowed: these clear it, for a change to a screen's set made in its settings meanwhile. */
export const NOT_BORROWED = { borrowedUntil: null, borrowedFrom: Prisma.DbNull } as const;

/**
 * The screen given back: what it showed before, as far as it still exists
 * (a set deleted meanwhile, a location gone: none), and the screen told.
 * Nothing when it isn't borrowed (given back already).
 */
export async function giveBackScreen(prisma: PrismaService, screenId: string): Promise<boolean> {
  const screen = await prisma.client.screen.findUnique({ where: { id: screenId }, select: { borrowedUntil: true, borrowedFrom: true } });
  if (!screen?.borrowedUntil) return false;
  const from = readBorrowedFrom(screen.borrowedFrom) ?? { setlistId: null, setMode: "FIXED", setByUserId: null, locationId: null, setlistPickedOn: null };
  const [setlist, setBy, location] = await Promise.all([
    from.setlistId ? prisma.client.setlist.findUnique({ where: { id: from.setlistId }, select: { id: true } }) : null,
    from.setByUserId ? prisma.client.user.findUnique({ where: { id: from.setByUserId }, select: { id: true } }) : null,
    from.locationId ? prisma.client.location.findUnique({ where: { id: from.locationId }, select: { id: true } }) : null,
  ]);
  // Only if it's still borrowed: given back twice at once, the second does nothing.
  const { count } = await prisma.client.screen.updateMany({
    where: { id: screenId, borrowedUntil: screen.borrowedUntil },
    data: {
      setlistId: setlist?.id ?? null,
      setMode: from.setMode === "LOCATION" && !location ? "FIXED" : from.setMode,
      setByUserId: setBy?.id ?? null,
      locationId: location?.id ?? null,
      setlistPickedOn: from.setlistPickedOn,
      ...NOT_BORROWED,
    },
  });
  if (count) await redis().publish(SCREEN_CHANNEL, screenId);
  return count > 0;
}

/** Every screen whose time is up, given back (the Worker, every minute). How many. */
export async function giveBackDueScreens(prisma: PrismaService, now = new Date()): Promise<number> {
  const due = await prisma.client.screen.findMany({ where: { borrowedUntil: { lte: now } }, select: { id: true } });
  let given = 0;
  for (const screen of due) if (await giveBackScreen(prisma, screen.id)) given++;
  return given;
}
