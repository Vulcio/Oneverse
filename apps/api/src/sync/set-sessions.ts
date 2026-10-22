import { Logger } from "@nestjs/common";
import { applyStageCommand, readItemTimer, readScreenReport, SCREEN_REPORT_MIN_GAP_MS, STEM_SPEED_MAX, STEM_SPEED_MIN, type SyncClientMessage, type SyncMember, type SyncMetronome, type SyncPresenting, type SyncSession, type SyncStage, type SyncStageCommand, type SyncStems } from "@oneverse/core";
import { randomUUID } from "node:crypto";
import { redis } from "../jobs/redis.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { capabilitiesIn } from "../roles/capabilities.js";
import type { ScreensService } from "../screens/screens.service.js";
import { SCREEN_ONLINE_TTL_S, SCREEN_REPORT_TTL_S, screenOnlineKey, screenReportKey } from "../screens/screen-channel.js";
import type { SetlistAccessService } from "../setlists/setlist-access.service.js";
import { ACCESS_RECHECK_MS, PRESENCE_MS, SESSION_TTL_S, type Connection, type SyncHub } from "./sync-connection.js";

/** A set's session or who's in it changed: announced to every instance, each sending it to its own connections in the set. */
export const CHANNEL = "songverse:sync:changed";
const sessionKey = (setId: string) => `songverse:sync:session:${setId}`;
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
/**
 * How long the screens stay with an operator whose connection dropped (a
 * Wi-Fi blip at the desk, a reload): their console takes them back on
 * reconnecting, and until then a lock stays theirs. After it, they're the
 * leader's again.
 */
const SCREENS_GRACE_MS = 60_000;
/** The most people the leader hands presenting to (issue #305). */
const PRESENTERS_MAX = 20;
/** The media operator's timer and message for a set's screens (issue #269): kept without a session. */
const stageKey = (setId: string) => `songverse:sync:stage:${setId}`;
/** A stage nobody changed for this long is gone: a service, and then some. */
const STAGE_TTL_S = 12 * 60 * 60;

interface StoredSession extends Omit<SyncSession, "leader" | "screens"> {
  leader: { id: string; name: string; conn: string };
  /** The media operator running the screens (issue #275), by connection; `leftAt`: when that connection went, kept SCREENS_GRACE_MS for it to come back. */
  screens?: { id: string; name: string; conn: string; exclusive: boolean; leftAt?: number } | null;
}

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
    // The operator gone: the screens wait for them a while (SCREENS_GRACE_MS), then are the leader's again (issue #275).
    await this.withSetLock(setId, async () => {
      const session = await this.read(setId);
      if (session?.screens?.conn !== `${this.hub.instance}:${connection.id}`) return;
      await redis().set(sessionKey(setId), JSON.stringify({ ...session, rev: session.rev + 1, screens: dropped ? { ...session.screens, leftAt: Date.now() } : null }), "EX", SESSION_TTL_S);
      if (!dropped) return;
      // Not back by then: everyone's told they're the leader's again (read() leaves them out from then on).
      setTimeout(() => void this.changed(setId).catch(() => undefined), SCREENS_GRACE_MS + 500).unref?.();
    }).catch(() => undefined);
    await redis().hdel(membersKey(setId), `${this.hub.instance}:${connection.id}`).catch(() => undefined);
    await this.changed(setId);
  }

  async lead(connection: Connection) {
    const setId = connection.setId;
    if (!setId) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Join a set first" });
    if (!(await this.stillAllowed(connection))) return;
    if (!connection.canLead) return this.hub.send(connection, { type: "error", code: "forbidden", message: "Only someone who can edit the set leads it" });
    await this.withSetLock(setId, async () => {
      const current = await this.read(setId);
      const session: StoredSession = {
        rev: (current?.rev ?? 0) + 1,
        leader: { id: connection.user!.id, name: connection.user!.name, conn: `${this.hub.instance}:${connection.id}` },
        // Taking over carries on from where it was.
        metronome: current?.metronome ?? null,
        stems: current?.stems ?? null,
        itemId: current?.itemId ?? null,
        presenting: current?.presenting ?? null,
        presentingRev: current?.presentingRev ?? 0,
        // Who the last leader handed presenting to keeps it (issue #305), and an operator running the screens keeps them (issue #275).
        presenters: current?.presenters ?? [],
        screens: current?.screens ?? null,
      };
      await this.write(setId, session);
    });
  }

  async update(connection: Connection, message: Extract<SyncClientMessage, { type: "update" }>) {
    const setId = connection.setId;
    if (setId && !(await this.stillAllowed(connection))) return;
    if (!setId) return this.hub.send(connection, { type: "error", code: "forbidden", message: "Only the leader changes the session" });
    await this.withSetLock(setId, () => this.updateLocked(connection, setId, message));
  }

  private async updateLocked(connection: Connection, setId: string, message: Extract<SyncClientMessage, { type: "update" }>) {
    const current = await this.read(setId);
    if (!current || !connection.canLead || current.leader.conn !== `${this.hub.instance}:${connection.id}`) {
      return this.hub.send(connection, { type: "error", code: "forbidden", message: "Only the leader changes the session" });
    }
    const next: StoredSession = { ...current, rev: current.rev + 1 };
    if (message.metronome !== undefined) {
      if (message.metronome !== null && !validMetronome(message.metronome)) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Invalid metronome" });
      next.metronome = message.metronome;
    }
    if (message.stems !== undefined) {
      if (message.stems !== null && !validStems(message.stems)) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Invalid stems" });
      next.stems = message.stems;
    }
    if (message.itemId !== undefined) next.itemId = typeof message.itemId === "string" ? message.itemId.slice(0, 64) : null;
    // Another item: its own timer, if it has one, starts (issue #269).
    if (next.itemId && next.itemId !== current.itemId) await this.itemTimer(setId, next.itemId).catch(() => undefined);
    if (message.presenting !== undefined) {
      if (message.presenting !== null && !validPresenting(message.presenting)) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Invalid presenting" });
      // Control locked to an operator (issues #275, #305): the leader's Live waits.
      if (current.screens?.exclusive && current.screens.id !== connection.user!.id) return this.hub.send(connection, { type: "error", code: "forbidden", message: `${current.screens.name} runs the screens` });
      if (this.stale(connection, current, message.presentingBasedOn)) return;
      if (!samePresenting(current.presenting ?? null, message.presenting)) {
        next.presenting = message.presenting;
        next.presentingRev = (current.presentingRev ?? 0) + 1;
      }
    }
    await this.write(setId, next);
  }

  /**
   * The media operator (issue #275) takes the screens - shared with the
   * leader, or alone - or gives them back. With no session yet, it starts
   * one, led by them: someone has to.
   */
  async takeScreens(connection: Connection, control: "shared" | "exclusive" | null) {
    const setId = connection.setId;
    if (!setId) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Join a set first" });
    if (!(await this.stillAllowed(connection))) return;
    if (!connection.canLead && !connection.canOperate) return this.hub.send(connection, { type: "error", code: "forbidden", message: "Only someone who can edit the set, or runs screens, runs its screens" });
    if (control !== null && control !== "shared" && control !== "exclusive") return this.hub.send(connection, { type: "error", code: "bad-request", message: "Invalid control" });
    await this.withSetLock(setId, () => this.takeScreensLocked(connection, setId, control));
  }

  private async takeScreensLocked(connection: Connection, setId: string, control: "shared" | "exclusive" | null) {
    const conn = `${this.hub.instance}:${connection.id}`;
    const current = await this.read(setId);
    if (!current) {
      if (control === null) return;
      return this.write(setId, {
        rev: 1,
        leader: { id: connection.user!.id, name: connection.user!.name, conn },
        metronome: null,
        stems: null,
        itemId: null,
        presenting: null,
        presentingRev: 0,
        presenters: [],
        screens: { id: connection.user!.id, name: connection.user!.name, conn, exclusive: control === "exclusive" },
      });
    }
    // Giving them back: only who has them. Locking them: not while someone else has them locked.
    // Who has them is a person: back from a dropped connection, they take them again.
    if (control === null && current.screens?.id !== connection.user!.id) return;
    if (current.screens?.exclusive && current.screens.id !== connection.user!.id) return this.hub.send(connection, { type: "error", code: "forbidden", message: `${current.screens.name} runs the screens` });
    await this.write(setId, { ...current, rev: current.rev + 1, screens: control === null ? null : { id: connection.user!.id, name: connection.user!.name, conn, exclusive: control === "exclusive" } });
  }

  /**
   * What the screens show (issues #275, #305), from anyone who may present -
   * unless control is locked to someone else. A command based on what the
   * screens no longer show is refused ("stale"), and the device is sent what
   * they show now.
   */
  async presentFromOperator(connection: Connection, presenting: SyncPresenting | null, basedOn: unknown) {
    const setId = connection.setId;
    if (setId && !(await this.stillAllowed(connection))) return;
    if (!setId) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Join a set first" });
    if (presenting !== null && !validPresenting(presenting)) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Invalid presenting" });
    if (basedOn !== undefined && !(Number.isInteger(basedOn) && (basedOn as number) >= 0)) return this.hub.send(connection, { type: "error", code: "bad-request", message: "basedOn must be a revision" });
    await this.withSetLock(setId, async () => {
      const current = await this.read(setId);
      if (!current) return this.hub.send(connection, { type: "error", code: "forbidden", message: "Nobody's leading this set yet: take the screens first" });
      if (!this.mayPresent(connection, current)) {
        const locked = current.screens?.exclusive && current.screens.id !== connection.user?.id;
        return this.hub.send(connection, { type: "error", code: "forbidden", message: locked ? `${current.screens!.name} runs the screens` : "Take the screens first" });
      }
      if (this.stale(connection, current, basedOn as number | undefined)) return;
      if (samePresenting(current.presenting ?? null, presenting)) return;
      await this.write(setId, { ...current, rev: current.rev + 1, presenting, presentingRev: (current.presentingRev ?? 0) + 1 });
    });
  }

  /** The leader hands presenting to someone in the set, or takes it back (issue #305). */
  async presenter(connection: Connection, message: Extract<SyncClientMessage, { type: "presenter" }>) {
    const setId = connection.setId;
    if (setId && !(await this.stillAllowed(connection))) return;
    if (!setId || typeof message.userId !== "string" || typeof message.allow !== "boolean") return this.hub.send(connection, { type: "error", code: "bad-request", message: "Give a userId and allow" });
    await this.withSetLock(setId, async () => {
      const current = await this.read(setId);
      if (!current || current.leader.conn !== `${this.hub.instance}:${connection.id}`) return this.hub.send(connection, { type: "error", code: "forbidden", message: "Only the leader hands presenting to someone" });
      const presenters = (current.presenters ?? []).filter((one) => one.id !== message.userId);
      if (message.allow) {
        // Someone in the set now, by the name they're there with.
        const member = Object.values(await redis().hgetall(membersKey(setId)))
          .map((raw) => JSON.parse(raw) as { id: string; name: string; screen?: boolean })
          .find((one) => one.id === message.userId && !one.screen);
        if (!member) return this.hub.send(connection, { type: "error", code: "bad-request", message: "They're not in the set" });
        if (presenters.length >= PRESENTERS_MAX) return this.hub.send(connection, { type: "error", code: "bad-request", message: `Hand presenting to ${PRESENTERS_MAX} people at most` });
        presenters.push({ id: member.id, name: member.name });
      }
      await this.write(setId, { ...current, rev: current.rev + 1, presenters });
    });
  }

  /** Whether this device may present now (issue #305): it leads, runs screens by a role, can edit the set or was handed it - and control isn't locked to someone else. */
  private mayPresent(connection: Connection, session: StoredSession): boolean {
    const conn = `${this.hub.instance}:${connection.id}`;
    if (!connection.user) return false;
    // Locked to someone (issue #305): to them, on whichever of their devices - one they came back on after a drop too.
    if (session.screens?.exclusive && session.screens.id !== connection.user.id) return false;
    return connection.canLead || connection.canOperate || session.leader.conn === conn || !!session.presenters?.some((one) => one.id === connection.user!.id);
  }

  /** A command based on what the screens showed before the last change (issue #305): refused, with what they show now. */
  private stale(connection: Connection, current: StoredSession, basedOn: number | undefined): boolean {
    if (basedOn === undefined || basedOn === (current.presentingRev ?? 0)) return false;
    this.hub.send(connection, { type: "error", code: "stale", message: "The screens moved on before this: here's what they show now" });
    void this.broadcastLocal(connection.setId!);
    return true;
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

  async end(connection: Connection) {
    const setId = connection.setId;
    if (setId && !(await this.stillAllowed(connection))) return;
    if (!setId || !connection.canLead) return this.hub.send(connection, { type: "error", code: "forbidden", message: "Only someone who can edit the set ends it" });
    await redis().del(sessionKey(setId));
    await this.changed(setId);
  }

  /** The session; screens whose operator left more than SCREENS_GRACE_MS ago are the leader's again. */
  private async read(setId: string): Promise<StoredSession | null> {
    const raw = await redis().get(sessionKey(setId));
    if (!raw) return null;
    const session = JSON.parse(raw) as StoredSession;
    if (session.screens?.leftAt !== undefined && Date.now() - session.screens.leftAt >= SCREENS_GRACE_MS) session.screens = null;
    return session;
  }

  private async write(setId: string, session: StoredSession) {
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
    const members: SyncMember[] = present.map((member) => ({ id: member.id, name: member.name, leading: member.conn === stored?.leader.conn, ...(member.screen ? { screen: true } : {}) }));
    const session: SyncSession | null = stored
      ? {
          ...stored,
          leader: { id: stored.leader.id, name: stored.leader.name, online: present.some((member) => member.conn === stored.leader.conn) },
          screens: stored.screens ? { id: stored.screens.id, name: stored.screens.name, exclusive: stored.screens.exclusive, ...(stored.screens.leftAt !== undefined && { online: false }) } : null,
        }
      : null;
    for (const connection of local) {
      this.hub.send(connection, {
        type: "session",
        setId,
        session,
        members,
        leading: stored?.leader.conn === `${this.hub.instance}:${connection.id}`,
        canLead: connection.canLead,
        stage,
        screensMine: !!stored?.screens && stored.screens.conn === `${this.hub.instance}:${connection.id}`,
        canPresent: stored ? this.mayPresent(connection, stored) : connection.canLead || connection.canOperate,
        canOperate: connection.canLead || connection.canOperate,
      });
    }
  }
}

/** The same slide, black or not: no change, so no new revision (issue #305). */
function samePresenting(a: SyncPresenting | null, b: SyncPresenting | null): boolean {
  if (!a || !b) return a === b;
  return a.itemId === b.itemId && a.slide === b.slide && a.black === b.black;
}

function validStems(value: SyncStems): boolean {
  return (
    typeof value === "object" &&
    typeof value.songVersionId === "string" &&
    value.songVersionId.length <= 64 &&
    (value.multitrackId === undefined || value.multitrackId === null || (typeof value.multitrackId === "string" && value.multitrackId.length <= 40)) &&
    typeof value.title === "string" &&
    value.title.length <= 300 &&
    (value.transpose === undefined || (Number.isInteger(value.transpose) && Math.abs(value.transpose) <= 12)) &&
    (value.transposeParts === undefined ||
      (typeof value.transposeParts === "object" &&
        value.transposeParts !== null &&
        Object.keys(value.transposeParts).length <= 64 &&
        Object.entries(value.transposeParts).every(([id, on]) => id.length <= 64 && typeof on === "boolean"))) &&
    (value.speed === undefined || (typeof value.speed === "number" && value.speed >= STEM_SPEED_MIN && value.speed <= STEM_SPEED_MAX)) &&
    typeof value.playing === "boolean" &&
    Number.isFinite(value.position) &&
    value.position >= 0 &&
    Number.isFinite(value.anchorAt)
  );
}

function validPresenting(value: SyncPresenting): boolean {
  return (
    typeof value === "object" &&
    typeof value.itemId === "string" &&
    value.itemId.length <= 64 &&
    Number.isInteger(value.slide) &&
    value.slide >= 0 &&
    value.slide < 10_000 &&
    typeof value.black === "boolean"
  );
}

function validMetronome(value: SyncMetronome): boolean {
  const s = value?.settings;
  return (
    typeof value === "object" &&
    typeof value.playing === "boolean" &&
    Number.isFinite(value.anchorAt) &&
    Number.isFinite(value.anchorPosition) &&
    !!s &&
    Number.isFinite(s.tempo) &&
    Number.isInteger(s.numerator) &&
    Number.isInteger(s.denominator) &&
    Array.isArray(s.beats) &&
    s.beats.length <= 32
  );
}
