import "../zod-config.js";
import { z } from "zod";
import { STEM_SPEED_MAX, STEM_SPEED_MIN } from "../stems/index.js";
import type { SyncPresenting, SyncSession } from "../sync/index.js";
import { cueTarget, type CueItem } from "./cue.js";

/**
 * The live session (issue #247, docs/live-session.md): how a set's session
 * changes, the same way wherever it runs - the API now, Oneverse Pulse when
 * the room runs on its own. Every change is an op from someone on a device,
 * checked and applied by applyLiveOp(); the server only reads the session,
 * applies the op under the set's lock and writes what comes back. The ops'
 * answers are shared test cases (conformance/live.json), for Pulse to pass too.
 */

/** Who holds a part of the session: a person, on a device (today a connection, `instance:id`). */
export interface LiveHolder {
  id: string;
  name: string;
  device: string;
}

/** A set's session as it's kept: SyncSession, with who leads it and runs its screens by device. */
export interface LiveSessionState extends Omit<SyncSession, "leader" | "screens"> {
  /** "cloud", or "pulse:<node id>" while a Pulse runs the session (see live/engine.ts). Left out: the cloud. */
  authority?: string;
  leader: LiveHolder;
  /** The media operator running the screens (issue #275); `leftAt`: when their device dropped, kept LIVE_SCREENS_GRACE_MS for it to come back. */
  screens?: (LiveHolder & { exclusive: boolean; leftAt?: number }) | null;
}

/** Who sends an op: a person on a device, and what they may do in the set (looked up fresh by the server). */
export interface LiveActor {
  userId: string;
  name: string;
  device: string;
  /** Can edit the set: leads it, runs its screens. */
  canLead: boolean;
  /** Runs screens by a role where the set's team or organisation has it (issue #270). */
  canOperate: boolean;
  /** Cues by a role where the set's team or organisation has it (issue #322): the next or previous song or section only. */
  canCue?: boolean;
}

/** What an op may need from the set beside the session, given by where it runs: a cue, the set's items as it cuts them (issue #322). */
export interface LiveOpContext {
  cueItems?: CueItem[];
}

/**
 * How long the screens stay with an operator whose device dropped (a Wi-Fi
 * blip at the desk, a reload, issue #312): their console takes them back on
 * reconnecting, and until then a lock stays theirs. After it, they're the
 * leader's again.
 */
export const LIVE_SCREENS_GRACE_MS = 60_000;

/** The most people the leader hands presenting to (issue #305). */
export const LIVE_PRESENTERS_MAX = 20;

const id = z.string().max(64);

/** A slide of a set item, or black (issue #186). */
export const SyncPresentingSchema = z.object({ itemId: id, slide: z.int().min(0).max(9_999), black: z.boolean(), slideKey: z.string().max(32).optional() });

/** The leader's metronome: its timeline, and its settings as the metronome reads them (the rest kept as sent). */
export const SyncMetronomeSchema = z.object({
  settings: z.looseObject({ tempo: z.number(), numerator: z.int(), denominator: z.int(), beats: z.array(z.unknown()).max(32) }),
  playing: z.boolean(),
  anchorAt: z.number(),
  anchorPosition: z.number(),
});

/** The leader's stems or recording (issue #100). */
export const SyncStemsSchema = z.object({
  songVersionId: id,
  multitrackId: z.string().max(40).nullish(),
  transpose: z.int().min(-12).max(12).optional(),
  transposeParts: z
    .record(id, z.boolean())
    .refine((parts) => Object.keys(parts).length <= 64)
    .optional(),
  speed: z.number().min(STEM_SPEED_MIN).max(STEM_SPEED_MAX).optional(),
  title: z.string().max(300),
  playing: z.boolean(),
  position: z.number().min(0),
  anchorAt: z.number(),
});

/** The revision of what's presented a command was decided from (issue #305). */
const basedOn = z.int().min(0).optional();

/** A change to a set's session; see applyLiveOp for what each does and who may. */
export const LiveOpSchema = z.discriminatedUnion("kind", [
  /** Starts a session, or takes over the lead of the one going on. */
  z.object({ kind: z.literal("lead") }),
  /** The leader's metronome, stems, open item and what's presented (sync play's `update`). */
  z.object({
    kind: z.literal("tempo"),
    metronome: SyncMetronomeSchema.nullable().optional(),
    stems: SyncStemsSchema.nullable().optional(),
    // Read as before: anything but a string is no item.
    itemId: z.unknown().optional(),
    presenting: SyncPresentingSchema.nullable().optional(),
    basedOn,
  }),
  /** The media operator takes the screens, shared or alone (issue #275), or gives them back (null). */
  z.object({ kind: z.literal("screens"), control: z.enum(["shared", "exclusive"]).nullable() }),
  /** What the screens show (issue #305), from anyone who may present. */
  z.object({ kind: z.literal("present"), presenting: SyncPresentingSchema.nullable(), basedOn }),
  /** The screens to the next or previous song or section (issue #322), from someone who may cue: where to is worked out from the set, not sent. */
  z.object({ kind: z.literal("cue"), direction: z.enum(["next", "previous"]), to: z.enum(["item", "section"]), basedOn }),
  /** The leader hands presenting to someone in the set, by the name they're there with, or takes it back. */
  z.object({ kind: z.literal("presenter"), userId: id, name: z.string().max(200).optional(), allow: z.boolean() }),
  /** The device leaves the set; `dropped`: its connection went, so the screens it runs wait for it. */
  z.object({ kind: z.literal("leave"), dropped: z.boolean() }),
  /** The device is back in the set (a reload, a Wi-Fi blip): what it held within its lease is its own again. */
  z.object({ kind: z.literal("back") }),
  /** Ends the session. */
  z.object({ kind: z.literal("end") }),
]);

export type LiveOp = z.input<typeof LiveOpSchema>;

/** What a device may send as a command: every op but those the server makes itself (leaving, coming back), and the presenter's name found by the server. */
export type LiveCommandOp = Exclude<LiveOp, { kind: "leave" } | { kind: "back" } | { kind: "presenter" }> | { kind: "presenter"; userId: string; allow: boolean };

/** A command's id: chosen by the device, 8 to 64 letters, digits, `-` or `_`. */
export const LIVE_COMMAND_ID = /^[A-Za-z0-9_-]{8,64}$/;

export type LiveRefusal = "forbidden" | "stale" | "bad-request";

/** An op's outcome: the session after it (null: none, ended) and whether it changed; or why it was refused. */
export type LiveResult = { ok: true; changed: boolean; session: LiveSessionState | null } | { ok: false; code: LiveRefusal; message: string };

/** What a field that can't be read is refused with, by field. */
const INVALID: Record<string, string> = {
  metronome: "Invalid metronome",
  stems: "Invalid stems",
  presenting: "Invalid presenting",
  basedOn: "basedOn must be a revision",
  control: "Invalid control",
  userId: "Give a userId and allow",
  allow: "Give a userId and allow",
  direction: "direction must be next or previous",
  to: "to must be item or section",
};

/** The session as it is at `now`: screens whose operator dropped more than LIVE_SCREENS_GRACE_MS ago are the leader's again. */
export function liveSessionAt(session: LiveSessionState | null, now: number): LiveSessionState | null {
  if (session?.screens?.leftAt === undefined || now - session.screens.leftAt < LIVE_SCREENS_GRACE_MS) return session;
  return { ...session, screens: null };
}

/** Whether someone may present now (issue #305): they lead, run screens, can edit the set or were handed it - and the screens aren't locked to someone else. */
export function mayPresent(session: LiveSessionState | null, actor: LiveActor): boolean {
  if (!session) return actor.canLead || actor.canOperate;
  // Locked to someone: to them, on whichever of their devices - one they came back on after a drop too.
  if (session.screens?.exclusive && session.screens.id !== actor.userId) return false;
  return actor.canLead || actor.canOperate || session.leader.device === actor.device || !!session.presenters?.some((one) => one.id === actor.userId);
}

/** Whether someone may cue now (issue #322): anyone who may present, or cues by a role - and the screens aren't locked to someone else. */
export function mayCue(session: LiveSessionState | null, actor: LiveActor): boolean {
  if (mayPresent(session, actor)) return true;
  if (!actor.canCue) return false;
  return !(session?.screens?.exclusive && session.screens.id !== actor.userId);
}

/** Whether two "this item, slide N" say the same: the same slide, black or not, of the same words (issue #247). */
export function samePresenting(a: SyncPresenting | null, b: SyncPresenting | null): boolean {
  if (!a || !b) return a === b;
  return a.itemId === b.itemId && a.slide === b.slide && a.black === b.black && a.slideKey === b.slideKey;
}

const refuse = (code: LiveRefusal, message: string): LiveResult => ({ ok: false, code, message });
const unchanged = (session: LiveSessionState | null): LiveResult => ({ ok: true, changed: false, session });
const changed = (session: LiveSessionState | null): LiveResult => ({ ok: true, changed: true, session });

/**
 * A set's session after `actor`'s op, at `now` (server time, ms): pure, the
 * same answer wherever it runs. Each change goes up a revision (`rev`), and
 * a change of what's presented its own (`presentingRev`), which a command's
 * `basedOn` is checked against: two people pressing Next together move the
 * screens once, the second is refused as stale. An op that changes nothing
 * (the same slide again, giving back screens one doesn't have) is no change.
 */
export function applyLiveOp(stored: LiveSessionState | null, actor: LiveActor, input: unknown, now: number, context: LiveOpContext = {}): LiveResult {
  const parsed = LiveOpSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return refuse("bad-request", (typeof field === "string" && INVALID[field]) || "Invalid command");
  }
  const op = parsed.data;
  const current = liveSessionAt(stored, now);
  const me: LiveHolder = { id: actor.userId, name: actor.name, device: actor.device };
  const lockedBy = current?.screens?.exclusive && current.screens.id !== actor.userId ? current.screens.name : null;
  const stale = (basedOn: number | undefined) => basedOn !== undefined && basedOn !== (current?.presentingRev ?? 0);
  switch (op.kind) {
    case "lead":
      if (!actor.canLead) return refuse("forbidden", "Only someone who can edit the set leads it");
      return changed({
        // The same session, its id and epoch kept.
        ...(current?.sessionId !== undefined && { sessionId: current.sessionId, epoch: current.epoch ?? 0 }),
        rev: (current?.rev ?? 0) + 1,
        leader: me,
        // Taking over carries on from where it was.
        metronome: current?.metronome ?? null,
        stems: current?.stems ?? null,
        itemId: current?.itemId ?? null,
        presenting: current?.presenting ?? null,
        presentingRev: current?.presentingRev ?? 0,
        // Who the last leader handed presenting to keeps it (issue #305), and an operator running the screens keeps them (issue #275).
        presenters: current?.presenters ?? [],
        screens: current?.screens ?? null,
      });
    case "tempo": {
      if (!current || !actor.canLead || current.leader.device !== actor.device) return refuse("forbidden", "Only the leader changes the session");
      const next: LiveSessionState = { ...current, rev: current.rev + 1 };
      if (op.metronome !== undefined) next.metronome = op.metronome as LiveSessionState["metronome"];
      if (op.stems !== undefined) next.stems = op.stems;
      if (op.itemId !== undefined) next.itemId = typeof op.itemId === "string" ? op.itemId.slice(0, 64) : null;
      if (op.presenting !== undefined) {
        // Control locked to an operator (issues #275, #305): the leader's Live waits.
        if (lockedBy) return refuse("forbidden", `${lockedBy} runs the screens`);
        if (stale(op.basedOn)) return refuse("stale", "The screens moved on before this: here's what they show now");
        if (!samePresenting(current.presenting ?? null, op.presenting)) {
          next.presenting = op.presenting;
          next.presentingRev = (current.presentingRev ?? 0) + 1;
        }
      }
      return changed(next);
    }
    case "screens":
      if (!actor.canLead && !actor.canOperate) return refuse("forbidden", "Only someone who can edit the set, or runs screens, runs its screens");
      // With no session yet, taking the screens starts one, led by them: someone has to.
      if (!current) {
        if (op.control === null) return unchanged(null);
        return changed({ rev: 1, leader: me, metronome: null, stems: null, itemId: null, presenting: null, presentingRev: 0, presenters: [], screens: { ...me, exclusive: op.control === "exclusive" } });
      }
      // Giving them back: only who has them, a person (back from a dropped connection, they take them again). Locking them: not while someone else has them locked.
      if (op.control === null && current.screens?.id !== actor.userId) return unchanged(current);
      if (lockedBy) return refuse("forbidden", `${lockedBy} runs the screens`);
      return changed({ ...current, rev: current.rev + 1, screens: op.control === null ? null : { ...me, exclusive: op.control === "exclusive" } });
    case "present":
      if (!current) return refuse("forbidden", "Nobody's leading this set yet: take the screens first");
      if (!mayPresent(current, actor)) return refuse("forbidden", lockedBy ? `${lockedBy} runs the screens` : "Take the screens first");
      if (stale(op.basedOn)) return refuse("stale", "The screens moved on before this: here's what they show now");
      if (samePresenting(current.presenting ?? null, op.presenting)) return unchanged(current);
      return changed({ ...current, rev: current.rev + 1, presenting: op.presenting, presentingRev: (current.presentingRev ?? 0) + 1 });
    case "cue": {
      if (!current) return refuse("forbidden", "Nobody's leading this set yet");
      if (!mayCue(current, actor)) return refuse("forbidden", lockedBy ? `${lockedBy} runs the screens` : "Only someone who may present or cue moves the screens");
      if (stale(op.basedOn)) return refuse("stale", "The screens moved on before this: here's what they show now");
      if (!context.cueItems) return refuse("bad-request", "The set isn't known here");
      const presenting = cueTarget(context.cueItems, current.presenting ?? null, op.direction, op.to);
      // The end of the set, or the same slide: nowhere to go.
      if (!presenting || samePresenting(current.presenting ?? null, presenting)) return unchanged(current);
      return changed({ ...current, rev: current.rev + 1, presenting, presentingRev: (current.presentingRev ?? 0) + 1 });
    }
    case "presenter": {
      if (!current || current.leader.device !== actor.device) return refuse("forbidden", "Only the leader hands presenting to someone");
      const presenters = (current.presenters ?? []).filter((one) => one.id !== op.userId);
      if (op.allow) {
        // Named: someone in the set now, as the server found them there.
        if (op.name === undefined) return refuse("bad-request", "They're not in the set");
        if (presenters.length >= LIVE_PRESENTERS_MAX) return refuse("bad-request", `Hand presenting to ${LIVE_PRESENTERS_MAX} people at most`);
        presenters.push({ id: op.userId, name: op.name });
      }
      return changed({ ...current, rev: current.rev + 1, presenters });
    }
    case "leave":
      // The operator gone: the screens wait for them a while (LIVE_SCREENS_GRACE_MS), then are the leader's again (issue #275).
      if (!current?.screens || current.screens.device !== actor.device) return unchanged(current);
      return changed({ ...current, rev: current.rev + 1, screens: op.dropped ? { ...current.screens, leftAt: now } : null });
    case "back": {
      // Within the lease (LIVE_SCREENS_GRACE_MS) the same device takes the screens back by itself, locked or not.
      const screens = current?.screens;
      if (!current || !screens || screens.leftAt === undefined || screens.device !== actor.device) return unchanged(current);
      return changed({ ...current, rev: current.rev + 1, screens: { id: screens.id, name: screens.name, device: screens.device, exclusive: screens.exclusive } });
    }
    case "end":
      if (!actor.canLead) return refuse("forbidden", "Only someone who can edit the set ends it");
      return changed(null);
  }
}
export * from "./commands.js";
export * from "./cue.js";
