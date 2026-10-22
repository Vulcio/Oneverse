import { Logger } from "@nestjs/common";
import { applyLiveOp, applyStageCommand, LIVE_SCREENS_GRACE_MS, liveSessionAt, mayPresent, readItemTimer, readScreenReport, SCREEN_REPORT_MIN_GAP_MS, type LiveActor, type LiveOp, type LiveResult, type LiveSessionState, type SyncClientMessage, type SyncMember, type SyncPresenting, type SyncSession, type SyncStage, type SyncStageCommand } from "@oneverse/core";
import { randomUUID } from "node:crypto";
import { redis } from "../jobs/redis.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { capabilitiesIn } from "../roles/capabilities.js";
import { endLiveSession, startLiveSession } from "./live-sessions.js";
import type { ScreensService } from "../screens/screens.service.js";
import { SCREEN_ONLINE_TTL_S, SCREEN_REPORT_TTL_S, screenOnlineKey, screenReportKey } from "../screens/screen-channel.js";
import type { SetlistAccessService } from "../setlists/setlist-access.service.js";
import { ACCESS_RECHECK_MS, PRESENCE_MS, SESSION_TTL_S, type Connection, type SyncHub } from "./sync-connection.js";

/** A set's session or who's in it changed: announced to every instance, each sending it to its own connections in the set. */
export const CHANNEL = "songverse:sync:changed";
export const sessionKey = (setId: string) => `songverse:sync:session:${setId}`;
const membersKey = (setId: string) => `songverse:sync:members:${setId}`;
/**
 * One change to a set's session at a time (issue #305), across the API's
 * instances: each reads the session, checks it and writes it back under this
 * lock, so two people pressing Next together can't both be "based on" the
 * slide the first one moved from.
 */
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
    const screen = await this.screens.byToken(String(token));
    if (!screen) return this.hub.send(connection, { type: "error", code: "disconnected", message: "This screen was disconnected" });
    connection.screen = { id: screen.id, name: screen.name, mode: screen.mode, setId: screen.setlistId };
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
    const screen = await this.prisma.client.screen.findUnique({ where: { id: screenId }, select: { id: true, name: true, mode: true, setlistId: true } });
    for (const connection of mine) await this.refreshScreen(connection, screen);
  }

  private async refreshScreen(connection: Connection, screen: { id: string; name: string; mode: "LYRICS" | "CHART"; setlistId: string | null } | null) {
    if (!screen) {
      await this.leaveSet(connection);
      this.hub.send(connection, { type: "error", code: "disconnected", message: "This screen was disconnected" });
      connection.socket.close(4003, "Disconnected");
      return;
    }
    const before = connection.screen;
    connection.screen = { id: screen.id, name: screen.name, mode: screen.mode, setId: screen.setlistId };
    this.hub.send(connection, { type: "screen", screen: connection.screen });
    if (screen.setlistId !== connection.setId) {
      if (screen.setlistId) await this.joinAsScreen(connection, screen.setlistId);
      else await this.leaveSet(connection);
    } else if (before?.name !== screen.name && connection.setId) {
      await this.present(connection);
      await this.changed(connection.setId);
    }
  }

  async join(connection: Connection, setId: string) {
    if (connection.setId) await this.leaveSet(connection);
    const set = typeof setId === "string" ? await this.prisma.client.setlist.findUnique({ where: { id: setId }, select: { id: true, ownerUserId: true, ownerTeamId: true } }) : null;
    const access = set ? await this.access.access(connection.user!, set) : null;
    if (!set || !access?.canView) return this.hub.send(connection, { type: "error", code: "not-found", message: "Set not found" });
    connection.setId = set.id;
    connection.canLead = access.canEdit;
    // Run screens everywhere, or on the set's team or its organisation (issue #270).
    connection.canOperate = (await capabilitiesIn(this.prisma.client, connection.user!.id, set.ownerTeamId)).canOperateScreens;
    connection.accessCheckedAt = Date.now();
    await this.present(connection);
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
      await this.refreshScreen(connection, await this.prisma.client.screen.findUnique({ where: { id: connection.screen.id }, select: { id: true, name: true, mode: true, setlistId: true } }));
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
      connection.canOperate = (await capabilitiesIn(this.prisma.client, connection.user!.id, set?.ownerTeamId ?? null)).canOperateScreens;
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
    const { metronome, stems, itemId, presenting, presentingBasedOn } = message;
    await this.command(connection, { kind: "tempo", metronome, stems, itemId, presenting, basedOn: presentingBasedOn }, "Only the leader changes the session", "forbidden");
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
    const setId = connection.setId;
    const member =
      setId && message.allow === true
        ? Object.values(await redis().hgetall(membersKey(setId)))
            .map((raw) => JSON.parse(raw) as { id: string; name: string; screen?: boolean })
            .find((one) => one.id === message.userId && !one.screen)
        : undefined;
    await this.command(connection, { kind: "presenter", userId: message.userId, allow: message.allow, name: member?.name }, "Give a userId and allow");
  }

  async end(connection: Connection) {
    await this.command(connection, { kind: "end" }, "Only someone who can edit the set ends it", "forbidden");
  }

  /** A command from a device in a set (docs/live-session.md): its right to the set checked again, then applied under the set's lock by applyLiveOp. */
  private async command(connection: Connection, op: LiveOp, notInSet: string, code: "bad-request" | "forbidden" = "bad-request") {
    const setId = connection.setId;
    if (setId && !(await this.stillAllowed(connection))) return;
    if (!setId || !connection.user) return this.hub.send(connection, { type: "error", code, message: notInSet });
    const { result, previous } = await this.withSetLock(setId, () => this.applyLocked(connection, setId, op));
    if (!result.ok) {
      this.hub.send(connection, { type: "error", code: result.code, message: result.message });
      // Refused as stale (issue #305): with what the screens show now.
      if (result.code === "stale") void this.broadcastLocal(setId);
      return;
    }
    // Another item: its own timer, if it has one, starts (issue #269).
    const itemId = result.session?.itemId;
    if (op.kind === "tempo" && itemId && itemId !== previous?.itemId) await this.itemTimer(setId, itemId).catch(() => undefined);
  }

  private actor(connection: Connection): LiveActor {
    return { userId: connection.user!.id, name: connection.user!.name, device: this.hub.member(connection), canLead: connection.canLead, canOperate: connection.canOperate };
  }

  /** `op` applied to the set's session, under its lock; written and announced when it changed. With the session as it was. */
  private async applyLocked(connection: Connection, setId: string, op: LiveOp): Promise<{ result: LiveResult; previous: LiveSessionState | null }> {
    const previous = await this.read(setId);
    const result = applyLiveOp(previous, this.actor(connection), op, Date.now());
    if (result.ok && result.changed) {
      if (result.session) {
        // Started now, or kept from before sessions had one: its row and id (issue #247).
        if (!result.session.sessionId) {
          const row = await startLiveSession(this.prisma, setId, connection.user!.id).catch((err: unknown) => this.logger.error(`Can't record the live session of ${setId}: ${String(err)}`));
          if (row) Object.assign(result.session, { sessionId: row.id, epoch: row.epoch });
        }
        await this.write(setId, result.session);
      } else {
        await redis().del(sessionKey(setId));
        await this.changed(setId);
        if (previous?.sessionId) await endLiveSession(this.prisma, previous.sessionId).catch(() => undefined);
      }
    }
    return { result, previous };
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

  /** The media operator (issue #269): anyone who can lead the set changes its timer and its message to the stage. */
  async stage(connection: Connection, message: Extract<SyncClientMessage, { type: "stage" }>) {
    const setId = connection.setId;
    if (!setId) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Join a set first" });
    if (!(await this.stillAllowed(connection))) return;
    if (!connection.canLead && !connection.canOperate) return this.hub.send(connection, { type: "error", code: "forbidden", message: "Only someone who can edit the set, or runs screens, runs its screens" });
    const command: SyncStageCommand = { timer: message.timer, reset: message.reset === true, run: typeof message.run === "boolean" ? message.run : undefined, add: message.add, message: message.message, layers: message.layers };
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
    const member = connection.screen
      ? { id: connection.screen.id, name: connection.screen.name, screen: true, at: Date.now() }
      : { id: connection.user!.id, name: connection.user!.name, at: Date.now() };
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
      .map(([conn, raw]) => ({ conn, ...(JSON.parse(raw) as { id: string; name: string; at: number; screen?: boolean }) }))
      .filter((member) => now - member.at < PRESENCE_MS * 2);
    const members: SyncMember[] = present.map((member) => ({ id: member.id, name: member.name, leading: member.conn === stored?.leader.device, ...(member.screen ? { screen: true } : {}) }));
    const session: SyncSession | null = stored
      ? {
          ...stored,
          leader: { id: stored.leader.id, name: stored.leader.name, online: present.some((member) => member.conn === stored.leader.device) },
          screens: stored.screens ? { id: stored.screens.id, name: stored.screens.name, exclusive: stored.screens.exclusive, ...(stored.screens.leftAt !== undefined && { online: false }) } : null,
        }
      : null;
    for (const connection of local) {
      this.hub.send(connection, {
        type: "session",
        setId,
        session,
        members,
        leading: stored?.leader.device === this.hub.member(connection),
        canLead: connection.canLead,
        stage,
        screensMine: !!stored?.screens && stored.screens.device === this.hub.member(connection),
        canPresent: connection.user ? mayPresent(stored, this.actor(connection)) : false,
        canOperate: connection.canLead || connection.canOperate,
      });
    }
  }
}
