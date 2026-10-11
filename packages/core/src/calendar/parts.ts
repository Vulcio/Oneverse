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
  /** A part's own name, when it isn't one of those. */
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
}

/** Whether a member covers a part: they listed its instrument or role. A named part, anyone. */
export function coversPart(member: PartMember, part: EventPart): boolean {
  if (!part.part) return true;
  return member.instruments.includes(part.part) || member.techRoles.includes(part.part);
}

/** A part's stable key: its instrument or role, else "name:" and its name in lower case. */
export function partKey(part: EventPart): string {
  return part.part ? part.part : `name:${(part.name ?? "").trim().toLowerCase()}`;
}

/** One part on a date: who covers it, by answer, and how many short of what it needs. */
export interface PartCoverage {
  key: string;
  part: string | null;
  name: string | null;
  count: number;
  /** Members covering it who answered Available, If needed. */
  available: number;
  ifNeeded: number;
  /** How many more it needs than are available (0: covered). */
  missing: number;
}

/**
 * How a date's parts are covered by the members' answers (their own, or
 * Not available when away): each part, how many who cover it are
 * available or if needed, and how many it's short. A member counts for
 * each part they cover.
 */
export function partCoverage(parts: EventPart[], members: (PartMember & { answer: AvailabilityAnswer | null })[]): PartCoverage[] {
  return parts.map((part) => {
    const covering = members.filter((member) => coversPart(member, part));
    const available = covering.filter((member) => member.answer === "AVAILABLE").length;
    const ifNeeded = covering.filter((member) => member.answer === "IF_NEEDED").length;
    return { key: partKey(part), part: part.part ?? null, name: part.part ? null : (part.name ?? null), count: part.count, available, ifNeeded, missing: Math.max(0, part.count - available) };
  });
}
