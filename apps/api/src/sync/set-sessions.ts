import { Logger } from "@nestjs/common";
import { applyLiveOp, applyStageCommand, LIVE_SCREENS_GRACE_MS, LiveHandbackSchema, liveHandedBack, liveSessionAt, mayCue, mayPresent, mayRoute, readItemTimer, readScreenReport, SCREEN_REPORT_MIN_GAP_MS, stageOnlyLayers, SYNC_DEVICE_ID, LIVE_COMMAND_ID, type LiveActor, type LiveOp, type LiveOpContext, type LiveResult, type LiveSessionState, type SyncClientMessage, type SyncMember, type SyncPresenting, type SyncSession, type SyncStage, type SyncStageCommand } from "@oneverse/core";
import { randomUUID } from "node:crypto";
import { redis } from "../jobs/redis.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { capabilitiesIn } from "../roles/capabilities.js";
import { setCueItems } from "./cue-items.js";
import { endLiveSession, recordLiveOp, startLiveSession } from "./live-sessions.js";
import { issueLivePass, livePassKey, pulseRoomAddress } from "./live-pass.js";
import type { ScreensService } from "../screens/screens.service.js";
import { SCREEN_ONLINE_TTL_S, SCREEN_REPORT_TTL_S, screenOnlineKey, screenReportKey } from "../screens/screen-channel.js";
import type { SetlistAccessService } from "../setlists/setlist-access.service.js";
import { ACCESS_RECHECK_MS, PRESENCE_MS, SESSION_TTL_S, type Connection, type SyncHub } from "./sync-connection.js";

/** A set's session or who's in it changed: announced to every instance, each sending it to its own connections in the set. */
export const CHANNEL = "songverse:sync:changed";
export const sessionKey = (setId: string) => `songverse:sync:session:${setId}`;
/** The commands applied to a set's session (issue #247), by id: the revision each left it at, to acknowledge a resend without applying it again. */
const commandsKey = (setId: string) => `songverse:sync:commands:${setId}`;
const membersKey = (setId: string) => `songverse:sync:members:${setId}`;
/**
 * One change to a set's session at a time (issue #305), across the API's
 * instances: each reads the session, checks it and writes it back under this
 * lock, so two people pressing Next together can't both be "based on" the
 * slide the first one moved from.
 */
/** What a sync connection keeps of a screen, read from its row. */
const SCREEN_INFO_SELECT = { id: true, name: true, mode: true, setlistId: true, kind: true, expiresAt: true } as const;
type ScreenInfoRow = { id: string; name: string; mode: "LYRICS" | "CHART"; setlistId: string | null; kind: "SCREEN" | "PULSE"; expiresAt: Date | null };
const screenInfo = (screen: ScreenInfoRow) => ({ id: screen.id, name: screen.name, mode: screen.mode, setId: screen.setlistId, ...(screen.kind === "PULSE" && { pulse: true }) });

/** Who mirrors a set's session and hands it back (issue #247): someone who can edit it, or a Pulse paired to follow it (issue #320). */
const mayMirror = (connection: Connection) => connection.canLead || !!connection.screen?.pulse;

const lockKey = (setId: string) => `songverse:sync:lock:${setId}`;
const LOCK_MS = 3000;
/** Deletes the lock only if it's still the one taken (a lock that outlived LOCK_MS may be someone else's). */
const UNLOCK = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
/** The media operator's timer and message for a set's screens (issue #269): kept without a session. */
const stageKey = (setId: string) => `songverse:sync:stage:${setId}`;
/** A stage nobody changed for this long is gone: a service, and then some. */
const STAGE_TTL_S = 12 * 60 * 60;

/**
 * A set's live session (issues #13, #186, #275, #305): who's in the set and
 * who leads it, what the screens show and who runs them, the stage's timer,
 * message and layers (issue #269), and screens signed in as members. Kept in
 * Redis, changed under a per-set lock, announced on CHANNEL.
 */
export class SetSessions {
  private readonly logger = new Logger("Sync");
  /** Each set's broadcasts, one after another, and those waiting to start (see queueBroadcast). */
  private readonly broadcasts = new Map<string, Promise<void>>();
  private readonly waiting = new Set<string>();

  constructor(
    private readonly hub: SyncHub,
    private readonly prisma: PrismaService,
    private readonly access: SetlistAccessService,
    private readonly screens: ScreensService,
  ) {}

  /** A screen signing in (issue #186): its token, then its set, joined at once. */
  async signInScreen(connection: Connection, token: string) {
    const found = await this.screens.byToken(String(token));
    if (!found) return this.hub.send(connection, { type: "error", code: "disconnected", message: "This screen was disconnected" });
    // Following a location (issue #320): on the set of the event on there now.
    const screen = await this.screens.followLocation(found);
    connection.screen = screenInfo(screen);
    // A Pulse's device in its sets: its own, whatever connection it's on.
    if (screen.kind === "PULSE") connection.device = `p:${screen.id}`;
    connection.accessCheckedAt = Date.now();
    void this.screenOnline(screen.id, true);
    this.hub.send(connection, { type: "screen", screen: connection.screen });
    if (screen.setlistId) await this.joinAsScreen(connection, screen.setlistId);
  }

  private async joinAsScreen(connection: Connection, setId: string) {
    if (connection.setId) await this.leaveSet(connection);
    connection.setId = setId;
    connection.canLead = false;
    await this.present(connection);
    await this.changed(setId);
  }

  /** A screen's report about itself (issue #286): read, and kept a day for Screens to show; from a screen only, not more than every few seconds. */
  async report(connection: Connection, input: unknown) {
    if (!connection.screen) return this.hub.send(connection, { type: "error", code: "forbidden", message: "Only a screen reports" });
    const now = Date.now();
    if (connection.reportedAt && now - connection.reportedAt < SCREEN_REPORT_MIN_GAP_MS) return;
    const report = readScreenReport(input);
    if (!report) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Not a screen report" });
    connection.reportedAt = now;
    try {
      await redis().set(screenReportKey(connection.screen.id), JSON.stringify({ ...report, at: new Date(now).toISOString() }), "EX", SCREEN_REPORT_TTL_S);
    } catch {
      // Only for show, as whether it's online.
    }
  }

  /** Whether a screen is connected (issue #267), for Screens to show: set with each of its pings, gone when it goes. */
  async screenOnline(screenId: string, online: boolean) {
    try {
      if (online) await redis().set(screenOnlineKey(screenId), "1", "EX", SCREEN_ONLINE_TTL_S);
      // Another connection of the same screen (a reload) renews it with its next ping.
      else await redis().del(screenOnlineKey(screenId));
    } catch {
      // Only for show: the screen works without it.
    }
  }

  /** A screen changed or was deleted (announced by ScreensService): its connections here are told, moved or dropped. */
  async screenChanged(screenId: string) {
    const mine = [...this.hub.connections()].filter((connection) => connection.screen?.id === screenId);
    if (mine.length === 0) return;
    const screen = await this.prisma.client.screen.findUnique({ where: { id: screenId }, select: SCREEN_INFO_SELECT });
    for (const connection of mine) await this.refreshScreen(connection, screen);
  }

  /** A screen asked to show a pairing code again (issue #284): its connections here are told. */
  screenPairAgain(screenId: string) {
    for (const connection of this.hub.connections()) if (connection.screen?.id === screenId) this.hub.send(connection, { type: "pair-again" });
  }

  private async refreshScreen(connection: Connection, screen: ScreenInfoRow | null) {
    // A temporary pairing that has ended (issue #284) is disconnected, as one deleted.
    if (!screen || (screen.expiresAt && screen.expiresAt <= new Date())) {
      await this.leaveSet(connection);
      this.hub.send(connection, { type: "error", code: "disconnected", message: "This screen was disconnected" });
      connection.socket.close(4003, "Disconnected");
      return;
    }
    const before = connection.screen;
    connection.screen = screenInfo(screen);
    this.hub.send(connection, { type: "screen", screen: connection.screen });
    if (screen.setlistId !== connection.setId) {
      if (screen.setlistId) await this.joinAsScreen(connection, screen.setlistId);
      else await this.leaveSet(connection);
    } else if (before?.name !== screen.name && connection.setId) {
      await this.present(connection);
      await this.changed(connection.setId);
    }
  }

  /** Joins the set; `deviceId`: the device's own (issue #247), so what it held before a reload or a drop is still its own. */
  async join(connection: Connection, setId: string, deviceId?: unknown) {
    if (connection.setId) await this.leaveSet(connection);
    // The person's too: another account can't claim someone's device by its id.
    connection.device = typeof deviceId === "string" && SYNC_DEVICE_ID.test(deviceId) ? `d:${connection.user!.id}:${deviceId}` : undefined;
    const set = typeof setId === "string" ? await this.prisma.client.setlist.findUnique({ where: { id: setId }, select: { id: true, ownerUserId: true, ownerTeamId: true } }) : null;
    const access = set ? await this.access.access(connection.user!, set) : null;
    if (!set || !access?.canView) return this.hub.send(connection, { type: "error", code: "not-found", message: "Set not found" });
    connection.setId = set.id;
    connection.canLead = access.canEdit;
    // Run screens everywhere, or on the set's team or its organisation (issue #270).
    const capabilities = await capabilitiesIn(this.prisma.client, connection.user!.id, set.ownerTeamId);
    connection.canOperate = capabilities.canOperateScreens;
    connection.canCue = capabilities.canCue;
    connection.canRoute = capabilities.canRoute;
    connection.accessCheckedAt = Date.now();
    await this.present(connection);
    // Back within the lease: the screens it ran are its own again.
    await this.withSetLock(set.id, () => this.applyLocked(connection, set.id, { kind: "back" })).catch(() => undefined);
    await this.changed(set.id);
  }

  /**
   * Whether the connection may still be in its set, looked up again once
   * ACCESS_RECHECK_MS has passed; when it may not, it's taken out of the set
   * and told so (the device stops following).
   */
  async stillAllowed(connection: Connection): Promise<boolean> {
    const setId = connection.setId;
    if (connection.screen) {
      // A screen: still there, still on this set (its pairer could be changing it from elsewhere).
      if (Date.now() - connection.accessCheckedAt < ACCESS_RECHECK_MS) return !!setId;
      connection.accessCheckedAt = Date.now();
      // One following a location moves to the event on there now (issue #320).
      await this.screens.followLocationOf(connection.screen.id);
      await this.refreshScreen(connection, await this.prisma.client.screen.findUnique({ where: { id: connection.screen.id }, select: SCREEN_INFO_SELECT }));
      return !!connection.setId;
    }
    if (!setId || Date.now() - connection.accessCheckedAt < ACCESS_RECHECK_MS) return !!setId;
    connection.accessCheckedAt = Date.now();
    const [user, set] = await Promise.all([
      this.prisma.client.user.findUnique({ where: { id: connection.user!.id }, select: { bannedAt: true, deletedAt: true } }),
      this.prisma.client.setlist.findUnique({ where: { id: setId }, select: { id: true, ownerUserId: true, ownerTeamId: true } }),
    ]);
    const access = user && !user.bannedAt && !user.deletedAt && set ? await this.access.access(connection.user!, set) : null;
    if (access?.canView) {
      connection.canLead = access.canEdit;
      const capabilities = await capabilitiesIn(this.prisma.client, connection.user!.id, set?.ownerTeamId ?? null);
      connection.canOperate = capabilities.canOperateScreens;
      connection.canCue = capabilities.canCue;
      connection.canRoute = capabilities.canRoute;
      return true;
    }
    await this.leaveSet(connection);
    this.hub.send(connection, { type: "error", code: "not-found", message: "Set not found" });
    return false;
  }

  /** Out of its set; `dropped`: its connection went (rather than it leaving, or losing the set), so the screens it runs wait for it. */
  async leaveSet(connection: Connection, dropped = false) {
    const setId = connection.setId;
    if (!setId) return;
    connection.setId = null;
    if (connection.user) {
      const { result } = await this.withSetLock(setId, () => this.applyLocked(connection, setId, { kind: "leave", dropped })).catch(() => ({ result: null }));
      // Not back by then: everyone's told the screens are the leader's again (read() leaves them out from then on).
      if (result?.ok && result.changed && dropped) setTimeout(() => void this.changed(setId).catch(() => undefined), LIVE_SCREENS_GRACE_MS + 500).unref?.();
    }
    await redis().hdel(membersKey(setId), this.hub.member(connection)).catch(() => undefined);
    await this.changed(setId);
  }

  /** Starts a session, or takes over the lead of the one going on. */
  async lead(connection: Connection) {
    await this.command(connection, { kind: "lead" }, "Join a set first");
  }

  /** The leader's metronome, stems, open item and what's presented. */
  async update(connection: Connection, message: Extract<SyncClientMessage, { type: "update" }>) {
    const { metronome, stems, itemId, presenting, presentingBasedOn, playback } = message;
    await this.command(connection, { kind: "tempo", metronome, stems, itemId, presenting, basedOn: presentingBasedOn, playback }, "Only the leader changes the session", "forbidden");
  }

  /**
   * The media operator (issue #275) takes the screens - shared with the
   * leader, or alone - or gives them back. With no session yet, it starts
   * one, led by them: someone has to.
   */
  async takeScreens(connection: Connection, control: "shared" | "exclusive" | null) {
    await this.command(connection, { kind: "screens", control }, "Join a set first");
  }

  /**
   * What the screens show (issues #275, #305), from anyone who may present -
   * unless control is locked to someone else. A command based on what the
   * screens no longer show is refused ("stale"), and the device is sent what
   * they show now.
   */
  async presentFromOperator(connection: Connection, presenting: SyncPresenting | null, basedOn: unknown) {
    await this.command(connection, { kind: "present", presenting, basedOn: basedOn as number | undefined }, "Join a set first");
  }

  /** The leader hands presenting to someone in the set, or takes it back (issue #305): someone in the set now, by the name they're there with. */
  async presenter(connection: Connection, message: Extract<SyncClientMessage, { type: "presenter" }>) {
    await this.command(connection, await this.named(connection, { kind: "presenter", userId: message.userId, allow: message.allow }), "Give a userId and allow");
  }

  /** A presenter op with the name its person is in the set with, as the server finds them there; none when they aren't. */
  private async named(connection: Connection, op: { kind: "presenter"; userId: unknown; allow: unknown }): Promise<LiveOp> {
    const setId = connection.setId;
    const member =
      setId && op.allow === true
        ? Object.values(await redis().hgetall(membersKey(setId)))
            .map((raw) => JSON.parse(raw) as { id: string; name: string; screen?: boolean })
            .find((one) => one.id === op.userId && !one.screen)
        : undefined;
    return { kind: "presenter", userId: op.userId as string, allow: op.allow as boolean, name: member?.name };
  }

  /**
   * A command (issue #247, docs/live-session.md): any change to the session,
   * with an id the device chose. Applied once - the same id again (a resend
   * after a drop) is acknowledged again, not applied - and answered with
   * `ack` and the session's revision, or an `error` carrying its id. One from
   * another epoch of the session is refused (`epoch`): the device loads it again.
   */
  async runCommand(connection: Connection, message: Extract<SyncClientMessage, { type: "command" }>) {
    const id = message.id;
    if (typeof id !== "string" || !LIVE_COMMAND_ID.test(id)) return this.hub.send(connection, { type: "error", code: "bad-request", message: "A command needs an id" });
    const raw = (message.op ?? {}) as { kind?: unknown; userId?: unknown; allow?: unknown };
    // Leaving and coming back are the server's to say; a presenter's name too.
    if (raw.kind === "leave" || raw.kind === "back") return this.hub.send(connection, { type: "error", id, code: "bad-request", message: "Invalid command" });
    const op = raw.kind === "presenter" ? await this.named(connection, { kind: "presenter", userId: raw.userId, allow: raw.allow }) : (raw as LiveOp);
    if (message.epoch !== undefined && !Number.isInteger(message.epoch)) return this.hub.send(connection, { type: "error", id, code: "bad-request", message: "epoch must be a number" });
    await this.command(connection, op, "Join a set first", "bad-request", { id, epoch: message.epoch });
  }

  /**
   * Oneverse Pulse (issue #247): someone who can edit the set, in it, is sent
   * the session as it's kept, to take over from. `room`: its address on the
   * venue's network, a local one only (pulseRoomAddress), told to the set's
   * devices (`pulse`) while it's in the set.
   */
  async mirror(connection: Connection, room?: unknown) {
    if (!connection.setId) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Join a set first" });
    if (!(await this.stillAllowed(connection))) return;
    if (!mayMirror(connection)) return this.hub.send(connection, { type: "error", code: "forbidden", message: "Only someone who can edit the set mirrors its session" });
    connection.mirrors = true;
    if (room !== undefined) {
      // Mirrored all the same: only the set's devices aren't told where it is.
      const address = pulseRoomAddress(room);
      if (!address) this.hub.send(connection, { type: "error", code: "bad-request", message: "room must be an address on a local network" });
      else {
        connection.pulseRoom = address;
        await this.present(connection);
        await this.changed(connection.setId);
      }
    }
    this.queueBroadcast(connection.setId);
  }

  /** A pass to the set's session on Pulse's page (issue #247), with what this person may do in it now. */
  async pass(connection: Connection) {
    const setId = connection.setId;
    if (!setId || (!connection.user && !connection.screen?.pulse)) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Join a set first" });
    if (!(await this.stillAllowed(connection))) return;
    // A Pulse's own (issue #320): it needs the key its room's passes are checked with, not rights.
    const who = connection.user ? { sub: connection.user.id, name: connection.user.name } : { sub: `pulse:${connection.screen!.id}`, name: connection.screen!.name };
    const { pass, expiresAt } = issueLivePass({ ...who, setId, device: this.device(connection), canLead: connection.canLead, canOperate: connection.canOperate, canCue: !!connection.canCue });
    this.hub.send(connection, { type: "pass", setId, pass, key: livePassKey(), expiresAt });
  }

  /**
   * Pulse back online (docs/live-session.md, "Pulse: offline and back"): the
   * room's session taken as it is, under the set's lock (liveHandedBack: the
   * room wins, one epoch up, so a command a device sent the cloud meanwhile
   * is refused as from another epoch), its changes added to the record with
   * their origin, and the row told. From a paired Pulse on its set (issue
   * #320), or anyone who can edit the set - who could make the same changes
   * one by one.
   */
  async handBack(connection: Connection, input: unknown) {
    const setId = connection.setId;
    if (!setId) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Join a set first" });
    if (!(await this.stillAllowed(connection))) return;
    if (!mayMirror(connection)) return this.hub.send(connection, { type: "error", code: "forbidden", message: "Only someone who can edit the set hands its session back" });
    const parsed = LiveHandbackSchema.safeParse(input);
    if (!parsed.success) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Invalid handback" });
    const handback = parsed.data;
    const taken = await this.withSetLock(setId, async () => {
      const result = liveHandedBack(await this.read(setId), handback);
      if (result?.session) await this.write(setId, result.session);
      else if (result) {
        await redis().del(sessionKey(setId));
        await this.changed(setId);
      }
      return result;
    });
    if (!taken) return this.hub.send(connection, { type: "error", code: "stale", message: "The cloud's session isn't the one the room ran, or it was taken back already" });
    for (const entry of handback.record) {
      await recordLiveOp({ sessionId: handback.sessionId, ...entry }).catch((err: unknown) => this.logger.error(`Can't record the room's change to ${handback.sessionId}: ${String(err)}`));
    }
    const epoch = handback.epoch + 1;
    await this.prisma.client.liveSession
      .updateMany({ where: { id: handback.sessionId }, data: { epoch, authority: "cloud", ...(!taken.session && { status: "ENDED" as const, endedAt: new Date() }) } })
      .catch((err: unknown) => this.logger.error(`Can't record the handback of ${handback.sessionId}: ${String(err)}`));
    this.hub.send(connection, { type: "handedBack", sessionId: handback.sessionId, epoch, rev: taken.session?.rev ?? 0 });
  }

  async end(connection: Connection) {
    await this.command(connection, { kind: "end" }, "Only someone who can edit the set ends it", "forbidden");
  }

  /** A command from a device in a set (docs/live-session.md): its right to the set checked again, then applied under the set's lock by applyLiveOp. */
  private async command(connection: Connection, op: LiveOp, notInSet: string, code: "bad-request" | "forbidden" = "bad-request", as?: { id: string; epoch?: number }) {
    const setId = connection.setId;
    if (setId && !(await this.stillAllowed(connection))) return;
    const id = as && { id: as.id };
    if (!setId || !connection.user) return this.hub.send(connection, { type: "error", ...id, code, message: notInSet });
    // A cue goes where the set says (issue #322): its items, read before the lock.
    const context: LiveOpContext = op.kind === "cue" ? { cueItems: await setCueItems(this.prisma, setId) } : {};
    const outcome = await this.withSetLock(setId, async () => {
      if (as) {
        // Sent before: acknowledged again, applied once.
        const seen = await redis().hget(commandsKey(setId), as.id);
        if (seen !== null) return { kind: "again" as const, rev: Number(seen) };
        if (as.epoch !== undefined && as.epoch !== ((await this.read(setId))?.epoch ?? 0)) return { kind: "epoch" as const };
      }
      const applied = await this.applyLocked(connection, setId, op, context);
      if (as && applied.result.ok) {
        await redis().hset(commandsKey(setId), as.id, String(applied.result.session?.rev ?? 0));
        await redis().expire(commandsKey(setId), SESSION_TTL_S);
      }
      return { kind: "applied" as const, ...applied };
    });
    if (outcome.kind === "again") return this.hub.send(connection, { type: "ack", id: as!.id, rev: outcome.rev });
    if (outcome.kind === "epoch") return this.hub.send(connection, { type: "error", ...id, code: "epoch", message: "The session went on in another epoch: load it again" });
    const { result, previous } = outcome;
    if (result.ok && as) this.hub.send(connection, { type: "ack", id: as.id, rev: result.session?.rev ?? 0 });
    if (!result.ok) {
      this.hub.send(connection, { type: "error", ...id, code: result.code, message: result.message });
      // Refused as stale (issue #305): with what the screens show now.
      if (result.code === "stale") void this.broadcastLocal(setId);
      return;
    }
    // Another item: its own timer, if it has one, starts (issue #269).
    const itemId = result.session?.itemId;
    if (op.kind === "tempo" && itemId && itemId !== previous?.itemId) await this.itemTimer(setId, itemId).catch(() => undefined);
  }

  /** Who holds what in a session: the device, or the connection for a client that doesn't say which device it is. */
  private device(connection: Connection): string {
    return connection.device ?? this.hub.member(connection);
  }

  private actor(connection: Connection): LiveActor {
    return { userId: connection.user!.id, name: connection.user!.name, device: this.device(connection), canLead: connection.canLead, canOperate: connection.canOperate, canCue: !!connection.canCue, canRoute: !!connection.canRoute };
  }

  /** `op` applied to the set's session, under its lock; written and announced when it changed. With the session as it was. */
  private async applyLocked(connection: Connection, setId: string, op: LiveOp, context: LiveOpContext = {}): Promise<{ result: LiveResult; previous: LiveSessionState | null }> {
    const previous = await this.read(setId);
    const result = applyLiveOp(previous, this.actor(connection), op, Date.now(), context);
    if (result.ok && result.changed) {
      if (result.session) {
        // Started now, or kept from before sessions had one: its row and id (issue #247).
        if (!result.session.sessionId) {
          const row = await startLiveSession(this.prisma, setId, connection.user!.id).catch((err: unknown) => this.logger.error(`Can't record the live session of ${setId}: ${String(err)}`));
          if (row) Object.assign(result.session, { sessionId: row.id, epoch: row.epoch });
        }
        await this.write(setId, result.session);
        await this.record(connection, result.session, op);
      } else {
        await redis().del(sessionKey(setId));
        await this.changed(setId);
        if (previous) await this.record(connection, { ...previous, rev: previous.rev + 1 }, op);
        if (previous?.sessionId) await endLiveSession(this.prisma, previous.sessionId).catch(() => undefined);
      }
    }
    return { result, previous };
  }

  /** The change kept in the session's record (issue #247); losing it never stops the change. */
  private async record(connection: Connection, session: LiveSessionState, op: LiveOp) {
    if (!session.sessionId) return;
    const entry = { sessionId: session.sessionId, rev: session.rev, epoch: session.epoch ?? 0, at: Date.now(), userId: connection.user!.id, deviceId: this.device(connection), origin: "cloud", op };
    await recordLiveOp(entry).catch((err: unknown) => this.logger.error(`Can't record a change to the live session ${session.sessionId}: ${String(err)}`));
  }

  /** `fn` with the set's session to itself (see lockKey): across the API's instances, one change at a time. */
  private async withSetLock<T>(setId: string, fn: () => Promise<T>): Promise<T> {
    const key = lockKey(setId);
    const token = randomUUID();
    const until = Date.now() + LOCK_MS;
    while ((await redis().set(key, token, "PX", LOCK_MS, "NX")) !== "OK") {
      if (Date.now() > until) throw new Error(`The session of ${setId} stayed locked`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    try {
      return await fn();
    } finally {
      await redis()
        .eval(UNLOCK, 1, key, token)
        .catch(() => undefined);
    }
  }

  /**
   * The media operator (issue #269): anyone who can lead the set changes its
   * timer and its message to the stage. What the screens draw - their layers
   * (issue #322, Route) - is also changed by a role that routes, and only by
   * the holder while the screens are locked to someone (mayRoute).
   */
  async stage(connection: Connection, message: Extract<SyncClientMessage, { type: "stage" }>) {
    const setId = connection.setId;
    if (!setId) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Join a set first" });
    if (!(await this.stillAllowed(connection))) return;
    const command: SyncStageCommand = { timer: message.timer, reset: message.reset === true, run: typeof message.run === "boolean" ? message.run : undefined, add: message.add, message: message.message, layers: message.layers };
    if (!stageOnlyLayers(command) && !connection.canLead && !connection.canOperate) return this.hub.send(connection, { type: "error", code: "forbidden", message: "Only someone who can edit the set, or runs screens, runs its screens" });
    if (command.layers !== undefined && connection.user) {
      const session = await this.read(setId);
      if (!mayRoute(session, this.actor(connection))) {
        const lockedBy = session?.screens?.exclusive ? session.screens.name : null;
        return this.hub.send(connection, { type: "error", code: "forbidden", message: lockedBy ? `${lockedBy} runs the screens` : "Only someone who can edit the set, runs screens or routes them changes what they show" });
      }
    }
    // A layer cleared stays cleared while the slide on screen now is (issue #280).
    const presenting = command.layers?.clear?.length ? ((await this.read(setId))?.presenting ?? null) : null;
    const next = applyStageCommand(await this.readStage(setId), command, Date.now(), presenting);
    if (!next) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Invalid timer, message or layers" });
    await this.writeStage(setId, next);
  }

  /** A set item with a timer of its own (issue #269), come on in Live: the stage's timer, started. */
  private async itemTimer(setId: string, itemId: string) {
    const item = await this.prisma.client.setlistItem.findUnique({ where: { id: itemId }, select: { setlistId: true, timer: true } });
    const timer = item?.setlistId === setId ? readItemTimer(item.timer) : null;
    if (!timer) return;
    const next = applyStageCommand(await this.readStage(setId), { timer, run: true }, Date.now());
    if (next) await this.writeStage(setId, next);
  }

  private async readStage(setId: string): Promise<SyncStage | null> {
    const raw = await redis().get(stageKey(setId));
    return raw ? (JSON.parse(raw) as SyncStage) : null;
  }

  private async writeStage(setId: string, stage: SyncStage) {
    await redis().set(stageKey(setId), JSON.stringify(stage), "EX", STAGE_TTL_S);
    await this.changed(setId);
  }

  /** The session; screens whose operator left more than LIVE_SCREENS_GRACE_MS ago are the leader's again. */
  private async read(setId: string): Promise<LiveSessionState | null> {
    const raw = await redis().get(sessionKey(setId));
    if (!raw) return null;
    const session = JSON.parse(raw) as LiveSessionState;
    // Kept before the live session's state (#314): who held a part by `conn`.
    for (const holder of [session.leader, session.screens]) if (holder && !holder.device) holder.device = (holder as { conn?: string }).conn ?? "";
    return liveSessionAt(session, Date.now());
  }

  private async write(setId: string, session: LiveSessionState) {
    await redis().set(sessionKey(setId), JSON.stringify(session), "EX", SESSION_TTL_S);
    await this.changed(setId);
  }

  /** Tells every instance (this one included) that a set's session or who's in it changed. */
  private async changed(setId: string) {
    await redis().publish(CHANNEL, setId);
  }

  async present(connection: Connection) {
    if (!connection.setId || (!connection.user && !connection.screen)) return;
    const member = connection.screen?.pulse
      ? // A Pulse (issue #320) isn't a screen of the set: its address is told, when it gives one.
        { id: connection.screen.id, name: connection.screen.name, node: true, device: this.device(connection), at: Date.now(), ...(connection.mirrors && connection.pulseRoom && { pulse: connection.pulseRoom }) }
      : connection.screen
      ? { id: connection.screen.id, name: connection.screen.name, screen: true, at: Date.now() }
      : { id: connection.user!.id, name: connection.user!.name, device: this.device(connection), at: Date.now(), ...(connection.mirrors && connection.pulseRoom && { pulse: connection.pulseRoom }) };
    await redis().hset(membersKey(connection.setId), `${this.hub.instance}:${connection.id}`, JSON.stringify(member));
    await redis().expire(membersKey(connection.setId), SESSION_TTL_S);
  }

  /**
   * A set changed: its session sent again, after the one being sent. Run side
   * by side, an earlier read could reach the devices after a later one and
   * leave them on a stale session or stage (a layer the operator turned on,
   * never shown). One already waiting will read the latest: no second.
   */
  queueBroadcast(setId: string) {
    if (this.waiting.has(setId)) return;
    this.waiting.add(setId);
    const next = (this.broadcasts.get(setId) ?? Promise.resolve())
      .then(() => {
        this.waiting.delete(setId);
        return this.broadcastLocal(setId);
      })
      .catch((err: unknown) => this.logger.error(`Can't send the session of ${setId}: ${String(err)}`))
      .finally(() => {
        if (this.broadcasts.get(setId) === next) this.broadcasts.delete(setId);
      });
    this.broadcasts.set(setId, next);
  }

  /** The session and who's there, to this instance's connections in the set. */
  private async broadcastLocal(setId: string) {
    const local = [...this.hub.connections()].filter((connection) => connection.setId === setId);
    if (local.length === 0) return;
    const [stored, rawMembers, stage] = await Promise.all([this.read(setId), redis().hgetall(membersKey(setId)), this.readStage(setId)]);
    const now = Date.now();
    const present = Object.entries(rawMembers)
      .map(([conn, raw]) => ({ conn, ...(JSON.parse(raw) as { id: string; name: string; at: number; screen?: boolean; node?: boolean; device?: string; pulse?: string }) }))
      .filter((member) => now - member.at < PRESENCE_MS * 2);
    // A Pulse in the set (issue #247) isn't someone in it: its address is told instead.
    const pulse = present.find((member) => member.pulse)?.pulse ?? null;
    const members: SyncMember[] = present.filter((member) => !member.pulse && !member.node).map((member) => ({ id: member.id, name: member.name, leading: (member.device ?? member.conn) === stored?.leader.device, ...(member.screen ? { screen: true } : {}) }));
    const session: SyncSession | null = stored
      ? {
          ...stored,
          leader: { id: stored.leader.id, name: stored.leader.name, online: present.some((member) => (member.device ?? member.conn) === stored.leader.device) },
          screens: stored.screens ? { id: stored.screens.id, name: stored.screens.name, exclusive: stored.screens.exclusive, ...(stored.screens.leftAt !== undefined && { online: false }) } : null,
        }
      : null;
    for (const connection of local) {
      this.hub.send(connection, {
        type: "session",
        setId,
        session,
        members,
        leading: stored?.leader.device === this.device(connection),
        canLead: connection.canLead,
        stage,
        screensMine: !!stored?.screens && stored.screens.device === this.device(connection),
        canPresent: connection.user ? mayPresent(stored, this.actor(connection)) : false,
        canCue: connection.user ? mayCue(stored, this.actor(connection)) : false,
        canRoute: connection.user ? mayRoute(stored, this.actor(connection)) : false,
        canOperate: connection.canLead || connection.canOperate,
        ...(connection.mirrors && mayMirror(connection) && { live: stored }),
        ...(connection.user && { pulse }),
      });
    }
  }
}
