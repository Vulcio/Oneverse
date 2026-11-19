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
  /** It must be filled (issue #528): a date whose line-up lacks it says so ("Missing: Host"). */
  required?: boolean | null;
  /**
   * Teams whose members may put themselves on it while places are left
   * (issue #528, "open places"): the event's own team or groups of its
   * organisation, by ID. Never a given part (GIVEN_PARTS).
   */
  openTo?: string[] | null;
}

/** The most teams a part is open to. */
export const OPEN_TO_LIMIT = 10;

/** How many places of a part are left: its count less those on it, not declining. */
export function placesLeft(part: EventPart, lineup: readonly { partKey: string; status: AssignmentStatus }[]): number {
  const key = partKey(part);
  return Math.max(0, part.count - lineup.filter((one) => one.partKey === key && one.status !== "DECLINED").length);
}

/**
 * The open places (issue #528) someone may take on a date, by key: parts
 * open to one of their teams, not given ones, with places left, that
 * they aren't on already.
 */
export function volunteerOptions(parts: readonly EventPart[], lineup: readonly { userId: string | null; partKey: string; status: AssignmentStatus }[], userId: string, teamIds: ReadonlySet<string>): string[] {
  return parts
    .filter((part) => part.openTo?.some((id) => teamIds.has(id)) && !(part.part && isGivenPart(part.part)))
    .filter((part) => placesLeft(part, lineup) > 0 && !lineup.some((one) => one.partKey === partKey(part) && one.userId === userId && one.status !== "DECLINED"))
    .map((part) => partKey(part));
}

/** The required parts (issue #528) a line-up doesn't fill yet, by key. */
export function missingRequired(parts: readonly EventPart[], lineup: readonly { partKey: string; status: AssignmentStatus }[]): string[] {
  return parts.filter((part) => part.required && placesLeft(part, lineup) > 0).map((part) => partKey(part));
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
  /** The given parts (GIVEN_PARTS) a role lets them fill there (issue #520): the only ones who cover them. */
  givenParts?: string[];
}

/** Whether a member covers a part: they listed its instrument or role, or ticked the group's position. A named part, anyone. */
export function coversPart(member: PartMember, part: EventPart): boolean {
  if (part.position) return (member.positionIds ?? []).includes(part.position);
  if (!part.part) return true;
  if (isGivenPart(part.part)) return (member.givenParts ?? []).includes(part.part);
  return member.instruments.includes(part.part) || member.techRoles.includes(part.part);
}

/** A part's stable key: its instrument or role, "position:" and a position's ID, else "name:" and its name in lower case. */
export function partKey(part: EventPart): string {
  if (part.position) return `position:${part.position}`;
  return part.part ? part.part : `name:${(part.name ?? "").trim().toLowerCase()}`;
}

/**
 * The parts someone may say they'd like to play on a date (issue #520): the
 * date's own parts, when its event lists any; else what they play - their
 * instruments and roles. A given part (hosting) only for those a role gives
 * it. Wishes are kept by partKey().
 */
export function wishOptions(parts: readonly EventPart[], member: PartMember): EventPart[] {
  const given = member.givenParts ?? [];
  if (parts.length > 0) return parts.filter((part) => !part.part || !isGivenPart(part.part) || given.includes(part.part));
  return [...given, ...member.instruments, ...member.techRoles].map((part) => ({ part, count: 1 }));
}

/** The longest list of wishes kept with an answer. */
export const WISHES_LIMIT = 30;

/** Who takes charge of the music (issue #520): the role, and the part an event asks for. */
export const MUSIC_LEADER = "MUSIC_LEADER";
/**
 * Who hosts it ("Présidence", issue #520): picks its songs, passages and
 * announcements. A given part: covered only by those a role lets host
 * (Role.canHost) - not something one lists oneself.
 */
export const HOST = "HOST";
/**
 * Who speaks or preaches (issue #523). A given part too, from those a role
 * lets speak (Role.canSpeak) - and, unlike hosting, a guest: one of the
 * admin's People or someone without an account (GUEST_PARTS).
 */
export const SPEAKER = "SPEAKER";

/**
 * Parts filled only by those a role gives them (issue #520), never listed by
 * oneself: the part's key, and the Role field that gives it. An
 * organisation's role given to one of its groups gives it to the group's
 * members; given to one person, to them alone.
 */
export const GIVEN_PARTS = { [HOST]: "canHost", [SPEAKER]: "canSpeak" } as const satisfies Record<string, string>;

/** Given parts a guest can fill too (issue #523): someone from outside, by name or one of the admin's People. */
export const GUEST_PARTS: readonly string[] = [SPEAKER];

/**
 * Whether a part is for members only (brice, issue #520): a given part guests
 * can't fill - hosting. Never someone without an account or from outside the
 * team and its organisation.
 */
export function isMembersOnlyPart(key: string): boolean {
  return isGivenPart(key) && !GUEST_PARTS.includes(key);
}

/** Whether a part is one a role gives (GIVEN_PARTS). */
export function isGivenPart(key: string): boolean {
  return Object.hasOwn(GIVEN_PARTS, key);
}
/** The parts whose people edit the date's set (issue #520), in the order they're shown. */
export const SET_LEADING_PARTS: readonly string[] = [HOST, MUSIC_LEADER];

/** Whoever's on a date's line-up as its host or music leader, not declining (issue #520): they edit the date's set. */
export function setLeaders(lineup: readonly { userId: string | null; partKey: string; status: AssignmentStatus }[]): { userId: string; partKey: string }[] {
  const leading = lineup.filter((one) => SET_LEADING_PARTS.includes(one.partKey) && one.status !== "DECLINED" && one.userId);
  return leading.map((one) => ({ userId: one.userId!, partKey: one.partKey })).sort((a, b) => SET_LEADING_PARTS.indexOf(a.partKey) - SET_LEADING_PARTS.indexOf(b.partKey));
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

/**
 * When a replacement asked for goes to everyone who could take it (issue
 * #240): until then only those who answered If needed are asked - for a
 * day, or two hours when the date is less than two days away.
 */
export function swapWidensAt(requestedAt: string | Date, startsAt: string): string {
  const hour = 3_600_000;
  const asked = new Date(requestedAt).getTime();
  const soon = new Date(startsAt).getTime() - asked < 48 * hour;
  return new Date(asked + (soon ? 2 : 24) * hour).toISOString();
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

/**
 * A kind of event a team holds (issue #523): its name, usual timing, the
 * parts it needs and whether its dates get a set. A new event picked from
 * it starts as a copy.
 */
export interface EventTypeTemplate {
  /** Its name's key under teamCalendar.typeSuggestion, for a suggestion; the name itself once saved. */
  key: string;
  startTime: string | null;
  durationMinutes: number | null;
  parts: EventPart[];
  withSet: boolean;
}

/** The most types a team keeps. */
export const EVENT_TYPES_LIMIT = 30;

/**
 * In openTo (issue #528), for a suggestion or an organisation's event type:
 * the group the event is made in, swapped for its ID by partsForTeam().
 */
export const OWN_TEAM = "own";

/** The one who runs the screens (issue #528: "screen operator"). */
const MEDIA_OPERATOR = "MEDIA_OPERATOR";

/**
 * Types a team with none is offered (issue #523): a service with its host,
 * speaker and music leader, all required, and a screen operator - the
 * music leader and the operator open to the team's members (issue #528);
 * a worship night led by its music leader; a meeting, with no set.
 */
export const EVENT_TYPE_SUGGESTIONS: readonly EventTypeTemplate[] = [
  {
    key: "service",
    startTime: "10:00",
    durationMinutes: 120,
    parts: [
      { part: HOST, count: 1, required: true },
      { part: SPEAKER, count: 1, required: true },
      { part: MUSIC_LEADER, count: 1, required: true, openTo: [OWN_TEAM] },
      { part: MEDIA_OPERATOR, count: 1, required: true, openTo: [OWN_TEAM] },
    ],
    withSet: true,
  },
  { key: "worshipNight", startTime: "19:30", durationMinutes: 120, parts: [{ part: MUSIC_LEADER, count: 1, required: true, openTo: [OWN_TEAM] }], withSet: true },
  { key: "meeting", startTime: "19:00", durationMinutes: 60, parts: [], withSet: false },
];

/** Parts for a team (issue #528): places open to "the group the event is in" (OWN_TEAM) open to that team. */
export function partsForTeam(parts: readonly EventPart[], teamId: string): EventPart[] {
  return parts.map((part) => (part.openTo ? { ...part, openTo: [...new Set(part.openTo.map((id) => (id === OWN_TEAM ? teamId : id)))] } : part));
}
