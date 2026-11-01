import { z } from "zod";
import { PLAYBACK_SOURCES } from "../playback/index.js";
import { applyLiveOp, LIVE_COMMAND_ID, LIVE_PRESENTERS_MAX, LiveOpSchema, SyncMetronomeSchema, SyncPresentingSchema, SyncStemsSchema, type LiveActor, type LiveCommandOp, type LiveOp, type LiveOpContext, type LiveRefusal, type LiveSessionState } from "./index.js";

/**
 * Oneverse Pulse's side of a live session (issue #247, docs/live-session.md,
 * "Pulse: offline and back"): the same reducer, run on the venue's network
 * when the internet goes. Pulse mirrors the cloud's session while it's
 * online; when it's gone, it takes the session on from there, one epoch up,
 * applies the room's commands and keeps their record; when the cloud is back,
 * it hands both back (`handBack`) and the cloud takes the room's state as it
 * is (`liveHandedBack`). The room wins.
 */

const id = z.string().max(64);
const holder = z.object({ id, name: z.string().max(200), device: z.string().max(200) });

/** A session as Pulse mirrors it and hands it back: LiveSessionState, read. */
export const LiveSessionStateSchema = z.object({
  sessionId: id.optional(),
  epoch: z.int().min(0).optional(),
  /** "cloud", or "pulse:<node id>" while a Pulse runs the session. Left out: the cloud. */
  authority: z.string().max(80).optional(),
  rev: z.int().min(0),
  leader: holder,
  screens: holder.extend({ exclusive: z.boolean(), leftAt: z.number().optional() }).nullish(),
  metronome: SyncMetronomeSchema.nullable(),
  stems: SyncStemsSchema.nullish(),
  itemId: id.nullable(),
  presenting: SyncPresentingSchema.nullish(),
  presentingRev: z.int().min(0).optional(),
  presenters: z.array(z.object({ id, name: z.string().max(200) })).max(LIVE_PRESENTERS_MAX).optional(),
  /** What plays with the set's songs, the leader's choice for everyone (issue #366). */
  playback: z.record(id, z.enum(PLAYBACK_SOURCES)).optional(),
});

/** One change the room applied, as it's kept in the record (LiveSessionCommand). */
export const LiveRecordedOpSchema = z.object({
  rev: z.int().min(0),
  epoch: z.int().min(0),
  /** When, by the room's clock (ms). */
  at: z.number(),
  userId: id.nullable(),
  deviceId: z.string().max(200).nullable(),
  /** "pulse:<node id>". */
  origin: z.string().max(80),
  op: LiveOpSchema,
});
export type LiveRecordedOp = z.input<typeof LiveRecordedOpSchema>;

/** The most changes a handback carries: a service's worth and more. */
export const LIVE_HANDBACK_MAX = 5_000;

/** What Pulse sends the cloud when it's back: the session as the room has it, and what the room did. */
export const LiveHandbackSchema = z.object({
  sessionId: id,
  /** The epoch the room ran (the cloud's when Pulse took over, plus one). */
  epoch: z.int().min(1),
  /** "pulse:<node id>". */
  authority: z.string().regex(/^pulse:/).max(80),
  /** Null: the room ended it. */
  state: LiveSessionStateSchema.nullable(),
  record: z.array(LiveRecordedOpSchema).max(LIVE_HANDBACK_MAX),
});
export type LiveHandback = z.input<typeof LiveHandbackSchema>;

/**
 * The session once the room's handed back (pure, under the set's lock): the
 * room's state as it is, one epoch up, the cloud's authority again, and its
 * revisions past both what the cloud and the room went to - so every device,
 * whichever it kept talking to, sees a change, and a command decided before
 * it is stale. `session: null`: the room ended it. Null when it can't be
 * taken: another session than the cloud's, or the cloud already past that
 * epoch (handed back already, or by another Pulse).
 */
export function liveHandedBack(cloud: LiveSessionState | null, handback: z.output<typeof LiveHandbackSchema>): { session: LiveSessionState | null } | null {
  const room = handback.state;
  if (room && room.sessionId !== handback.sessionId) return null;
  // The cloud's session isn't the room's (another started, or it was ended): the room's isn't taken over it.
  if (cloud?.sessionId !== handback.sessionId) return null;
  if ((cloud.epoch ?? 0) >= handback.epoch) return null;
  if (!room) return { session: null };
  const rev = Math.max(cloud.rev, room.rev) + 1;
  const presentingRev = Math.max(cloud.presentingRev ?? 0, room.presentingRev ?? 0) + 1;
  return { session: { ...(room as LiveSessionState), epoch: handback.epoch + 1, authority: "cloud", rev, presentingRev } };
}

/** A command as the room's devices send it: as the cloud's (`{type: "command"}`). */
export interface LiveEngineCommand {
  id: string;
  epoch?: number;
  op: LiveCommandOp | LiveOp;
}

/** What the engine answers a command with: as the cloud does. */
export type LiveEngineAnswer = { type: "ack"; id: string; rev: number } | { type: "error"; id?: string; code: LiveRefusal | "epoch"; message: string };

/**
 * A set's session on Pulse: mirrored while the cloud runs it, run here once
 * it's taken over. Holds no connection: Pulse's server feeds it what the
 * cloud says (`mirror`) and what the room's devices send (`command`), and
 * sends what it answers.
 */
export class LiveEngine {
  private session: LiveSessionState | null = null;
  /** Taken over: the session the room runs, and its epoch (kept once the room ended it). */
  private taken: { sessionId: string; epoch: number; rev: number } | null = null;
  private readonly seen = new Map<string, number>();
  private readonly record: LiveRecordedOp[] = [];

  constructor(
    /** This Pulse's node id. */
    private readonly nodeId: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** "pulse:<node id>". */
  get authority(): string {
    return `pulse:${this.nodeId}`;
  }

  /** The session as it is here; null when there's none (or the room ended it). */
  get state(): LiveSessionState | null {
    return this.session;
  }

  /** Whether the room runs the session (taken over), rather than following the cloud. */
  get runs(): boolean {
    return this.taken !== null;
  }

  /** The cloud's session, while it runs it: kept to take over from. Ignored once the room runs it. */
  mirror(session: LiveSessionState | null) {
    if (!this.taken) this.session = session;
  }

  /** The internet gone: the room runs the session from where the cloud had it, one epoch up. False when there's none to run. */
  takeOver(): boolean {
    if (this.taken) return true;
    const sessionId = this.session?.sessionId;
    if (!this.session || !sessionId) return false;
    const epoch = (this.session.epoch ?? 0) + 1;
    this.session = { ...this.session, epoch, authority: this.authority };
    this.taken = { sessionId, epoch, rev: this.session.rev };
    return true;
  }

  /** A command from a device in the room: applied as the cloud would (applyLiveOp), once, and kept in the record. */
  command(actor: LiveActor, command: LiveEngineCommand, context: LiveOpContext = {}): LiveEngineAnswer {
    const { id } = command;
    if (typeof id !== "string" || !LIVE_COMMAND_ID.test(id)) return { type: "error", code: "bad-request", message: "A command needs an id" };
    const taken = this.taken;
    if (!taken) return { type: "error", id, code: "forbidden", message: "The cloud runs this session" };
    const kind = (command.op as { kind?: unknown } | null)?.kind;
    if (kind === "leave" || kind === "back") return { type: "error", id, code: "bad-request", message: "Invalid command" };
    const again = this.seen.get(id);
    if (again !== undefined) return { type: "ack", id, rev: again };
    if (command.epoch !== undefined && command.epoch !== taken.epoch) return { type: "error", id, code: "epoch", message: "The session went on in another epoch: load it again" };
    if (!this.session) return { type: "error", id, code: "forbidden", message: "The session ended" };
    const result = applyLiveOp(this.session, actor, command.op, this.now(), context);
    if (!result.ok) return { type: "error", id, code: result.code, message: result.message };
    const rev = result.session?.rev ?? taken.rev + 1;
    if (result.changed) {
      taken.rev = rev;
      this.record.push({ rev, epoch: taken.epoch, at: this.now(), userId: actor.userId, deviceId: actor.device, origin: this.authority, op: command.op as LiveOp });
      this.session = result.session && { ...result.session, sessionId: taken.sessionId, epoch: taken.epoch, authority: this.authority };
    }
    this.seen.set(id, rev);
    return { type: "ack", id, rev };
  }

  /** The cloud back: the room's state and record to send it; null when the room never ran the session. */
  handBack(): LiveHandback | null {
    if (!this.taken) return null;
    return { sessionId: this.taken.sessionId, epoch: this.taken.epoch, authority: this.authority, state: this.session, record: [...this.record] };
  }

  /** The cloud took it back (or wouldn't: another session went on there): following it again. */
  handedBack() {
    this.taken = null;
    this.record.length = 0;
    this.seen.clear();
  }
}
