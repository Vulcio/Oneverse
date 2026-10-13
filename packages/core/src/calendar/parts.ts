import type { AvailabilityAnswer } from "./index.js";

/**
 * The parts an event needs (issue #235, phase 7): an instrument or a role
 * members say they do (dashboard > Roles: INSTRUMENTS, an admin's custom
 * instrument's ID, TECH_ROLES), or a name the team gives ("Worship
 * leader"), each with how many.
 */
export interface EventPart {
  /** An instrument or role key, or a custom instrument's ID; null for a named part. */
  part?: string | null;
  /** One of the group's own positions (issue #241: "Greeter"), by its ID. */
  position?: string | null;
  /** A part's own name, when it isn't one of those; a position's, as it's shown. */
  name?: string | null;
  count: number;
}

/** The most parts an event lists, and the most people one part needs. */
export const EVENT_PARTS_LIMIT = 30;
export const EVENT_PART_COUNT_MAX = 20;

/** Who someone is, for the parts: what they said they do. */
export interface PartMember {
  instruments: string[];
  techRoles: string[];
  /** The group's own positions they cover (issue #241). */
  positionIds?: string[];
}

/** Whether a member covers a part: they listed its instrument or role, or ticked the group's position. A named part, anyone. */
export function coversPart(member: PartMember, part: EventPart): boolean {
  if (part.position) return (member.positionIds ?? []).includes(part.position);
  if (!part.part) return true;
  return member.instruments.includes(part.part) || member.techRoles.includes(part.part);
}

/** A part's stable key: its instrument or role, "position:" and a position's ID, else "name:" and its name in lower case. */
export function partKey(part: EventPart): string {
  if (part.position) return `position:${part.position}`;
  return part.part ? part.part : `name:${(part.name ?? "").trim().toLowerCase()}`;
}

/** Someone scheduled on a part for a date (issue #235, phase 7): asked, then accepted or declined. */
export const ASSIGNMENT_STATUSES = ["PENDING", "ACCEPTED", "DECLINED"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/**
 * Who signed up for a date: once it has a line-up (someone scheduled and
 * not declining), the people scheduled on it - asked or accepted; until
 * then, those who answered Available.
 */
export function signedUpPeople(answers: { userId: string; answer: AvailabilityAnswer | null }[], lineup: { userId: string; status: AssignmentStatus }[]): string[] {
  const scheduled = lineup.filter((one) => one.status !== "DECLINED").map((one) => one.userId);
  if (scheduled.length > 0) return [...new Set(scheduled)];
  return [...new Set(answers.filter((one) => one.answer === "AVAILABLE").map((one) => one.userId))];
}

/**
 * Who's offered someone's place when they ask for a replacement (issue
 * #235, phase 7): the members who cover its part, not the one asking, not
 * already on that part, and not unavailable that date (or away).
 */
export function swapCandidates(
  part: EventPart,
  members: (PartMember & { userId: string; answer: AvailabilityAnswer | null })[],
  lineup: { userId: string; partKey: string; status: AssignmentStatus }[],
  requesterId: string,
): string[] {
  const key = partKey(part);
  const onIt = new Set(lineup.filter((one) => one.partKey === key && one.status !== "DECLINED").map((one) => one.userId));
  return members.filter((member) => member.userId !== requesterId && !onIt.has(member.userId) && member.answer !== "UNAVAILABLE" && coversPart(member, part)).map((member) => member.userId);
}

/** One part on a date: who covers it, by answer, and how many short of what it needs. */
export interface PartCoverage {
  key: string;
  part: string | null;
  /** One of the group's positions (issue #241). */
  position: string | null;
  name: string | null;
  count: number;
  /** Members covering it who answered Available, If needed. */
  available: number;
  ifNeeded: number;
  /** How many are scheduled on it (asked or accepted). */
  scheduled: number;
  /** How many more it needs: than scheduled once the date has a line-up, else than available (0: covered). */
  missing: number;
}

/**
 * How a date's parts are covered by the members' answers (their own, or
 * Not available when away): each part, how many who cover it are
 * available or if needed, and how many it's short. A member counts for
 * each part they cover. Once the date has a line-up (`lineup`: who's
 * scheduled on which part), a part is short of what's scheduled on it.
 */
export function partCoverage(parts: EventPart[], members: (PartMember & { answer: AvailabilityAnswer | null })[], lineup: { partKey: string; status: AssignmentStatus }[] = []): PartCoverage[] {
  const live = lineup.filter((one) => one.status !== "DECLINED");
  return parts.map((part) => {
    const key = partKey(part);
    const covering = members.filter((member) => coversPart(member, part));
    const available = covering.filter((member) => member.answer === "AVAILABLE").length;
    const ifNeeded = covering.filter((member) => member.answer === "IF_NEEDED").length;
    const scheduled = live.filter((one) => one.partKey === key).length;
    const filled = live.length > 0 ? scheduled : available;
    return { key, part: part.part ?? null, position: part.position ?? null, name: part.part ? null : (part.name ?? null), count: part.count, available, ifNeeded, scheduled, missing: Math.max(0, part.count - filled) };
  });
}
