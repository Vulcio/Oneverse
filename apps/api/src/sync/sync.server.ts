import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { applyStageCommand, readItemTimer, readScreenReport, SCREEN_REPORT_MIN_GAP_MS, STEM_SPEED_MAX, STEM_SPEED_MIN, SYNC_DOC_UPDATE_MAX, SYNC_PATH, SYNC_WATCH_MAX, type SongActivity, type SongPresence, type SyncClientMessage, type SyncMember, type SyncMetronome, type SyncPresenting, type SyncScreenInfo, type SyncServerMessage, type SyncSession, type SyncStage, type SyncStageCommand, type SyncStems } from "@oneverse/core";
import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { JwtVerifierService } from "../auth/jwt-verifier.service.js";
import { redis } from "../jobs/redis.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { capabilitiesIn, capabilitiesOf } from "../roles/capabilities.js";
import { SCREEN_CHANNEL, ScreensService } from "../screens/screens.service.js";
import { SCREEN_ONLINE_TTL_S, SCREEN_REPORT_TTL_S, screenOnlineKey, screenReportKey } from "../screens/screen-channel.js";
import { SetlistAccessService } from "../setlists/setlist-access.service.js";
import { NOTES_CHANNEL, NotesService } from "../notes/notes.service.js";
import { SONG_CHANNEL, type SongSaved } from "../song-versions/song-announce.js";
import { NOTIFICATIONS_CHANNEL } from "../notifications/notifications.service.js";
import { AccessPolicyService } from "../access/access-policy.service.js";
import { liveCoEditingEnabled } from "./collaboration-settings.js";
import { announce, appendUpdate, claimReset, DOC_CHANNEL, joinRoom, keepRoom, leaveRoom, resetRoom, roomRevision, roomSaved, touchMember, validAwareness, validUpdate, type DocAnnouncement } from "./doc-room.js";

/** A session outlasts its leader's last change by this long, then goes. */
const SESSION_TTL_S = 12 * 60 * 60;
/** A device's presence is refreshed this often, and forgotten when older than twice that (its API instance stopped). */
const PRESENCE_MS = 20_000;
const CHANNEL = "songverse:sync:changed";
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
/** The most people the leader hands presenting to (issue #305). */
const PRESENTERS_MAX = 20;
/** The media operator's timer and message for a set's screens (issue #269): kept without a session. */
const stageKey = (setId: string) => `songverse:sync:stage:${setId}`;
/** A stage nobody changed for this long is gone: a service, and then some. */
const STAGE_TTL_S = 12 * 60 * 60;
/** Who's doing what in a song (issue #27), by connection; announced on PRESENCE_CHANNEL. */
const presenceKey = (songVersionId: string) => `songverse:presence:${songVersionId}`;
const PRESENCE_CHANNEL = "songverse:presence:changed";

interface StoredSession extends Omit<SyncSession, "leader" | "screens"> {
  leader: { id: string; name: string; conn: string };
  /** The media operator running the screens (issue #275), by connection. */
  screens?: { id: string; name: string; conn: string; exclusive: boolean } | null;
}

/**
 * How many messages a connection may send (issue #112): a burst, refilled
 * each second. A device sends a few a second at most (pings, a leader's
 * changes); one that floods is dropped.
 */
const MESSAGE_BURST = 60;
const MESSAGES_PER_SECOND = 30;
/** Songs a connection types in at once (issue #27). */
const DOC_ROOMS_MAX = 3;
/** A save heard for a song with a room, not said by one of its members within this, came from elsewhere: the room starts over. */
const OUTSIDE_SAVE_MS = 3000;
/**
 * How long a connection's right to its set is trusted before it's looked up
 * again (issue #112): someone taken off the set, no longer allowed to edit
 * it, or banned stops hearing it or leading it within this, not only when
 * they reconnect.
 */
const ACCESS_RECHECK_MS = 30_000;

interface Connection {
  id: string;
  /** Messages it may still send before it's dropped. */
  allowance: number;
  lastMessageAt: number;
  socket: WebSocket;
  user: (AuthenticatedUser & { name: string; avatarUrl: string | null }) | null;
  /** A screen (issue #186), signed in by its own token: it follows its set, never leads. */
  screen: SyncScreenInfo | null;
  setId: string | null;
  canLead: boolean;
  /** Runs screens by a role (issue #305): may present and lock control on the sets it can open. */
  canOperate: boolean;
  accessCheckedAt: number;
  /** A screen's last report kept (issue #286), ms. */
  reportedAt?: number;
  /**
   * Its messages handled one after the other (pings aside): a leader's two
   * quick updates - another song, then its slide - each read the session and
   * write it back, so handled together the first could write over the second.
   */
  queue: Promise<void>;
  /** The songs whose notes it's told about (issue #27), each one it may see. */
  watching: Set<string>;
  /** What it's doing in one of those songs, for the others in it (issue #27). */
  presence: { songVersionId: string; doing: SongActivity; noteId?: string } | null;
  /** The songs it types in with others (issue #27), with when its right to was last looked up. */
  docs: Map<string, number>;
}

/**
 * Sync play (issue #13): the API's WebSocket at /sync. A device signs in
 * with its first message (the API token the web app already has), joins a
 * set it can open, and hears the set's session - who leads, the metronome's
 * timeline, the song they're on - each time it changes. Someone who can
 * edit the set leads it: their updates are the session. Pings let each
 * device work out its clock against the server's.
 *
 * The session and who's connected are in Redis, and a change is announced
 * on a Redis channel, so it works across the API's instances: each sends
 * the new state to its own connections in that set.
 */
@Injectable()
export class SyncServer implements OnModuleDestroy {
  private readonly logger = new Logger("Sync");
  private readonly instance = randomUUID();
  private readonly connections = new Map<string, Connection>();
  /** Each set's broadcasts, one after another, and those waiting to start (see queueBroadcast). */
  private readonly broadcasts = new Map<string, Promise<void>>();
  private readonly waiting = new Set<string>();
  private wss: WebSocketServer | null = null;
  private subscriber: Redis | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly jwt: JwtVerifierService,
    private readonly prisma: PrismaService,
    private readonly access: SetlistAccessService,
    private readonly screens: ScreensService,
    private readonly notes: NotesService,
    private readonly policy: AccessPolicyService,
  ) {}

  /** Takes the WebSocket upgrades to /sync on the API's HTTP server (not in the Worker). */
  attach(server: Server) {
    // A shared document's update can be large (a pasted song).
    this.wss = new WebSocketServer({ noServer: true, maxPayload: SYNC_DOC_UPDATE_MAX + 4 * 1024 });
    server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = (request.url ?? "").split("?")[0];
      if (path !== SYNC_PATH) return;
      this.wss!.handleUpgrade(request, socket, head, (ws) => this.connected(ws));
    });
    this.subscriber = redis().duplicate();
    this.subscriber.subscribe(CHANNEL, SCREEN_CHANNEL, NOTES_CHANNEL, SONG_CHANNEL, PRESENCE_CHANNEL, NOTIFICATIONS_CHANNEL, DOC_CHANNEL).catch((err: unknown) => this.logger.error(`Can't listen for sync changes: ${String(err)}`));
    this.subscriber.on("message", (channel, id: string) => {
      if (channel === SCREEN_CHANNEL) void this.screenChanged(id);
      else if (channel === NOTES_CHANNEL) this.notesChanged(id);
      else if (channel === SONG_CHANNEL) this.songSaved(id);
      else if (channel === PRESENCE_CHANNEL) void this.presenceChanged(id);
      else if (channel === NOTIFICATIONS_CHANNEL) this.notificationsChanged(id);
      else if (channel === DOC_CHANNEL) this.docAnnounced(id);
      else this.queueBroadcast(id);
    });
    this.presenceTimer = setInterval(() => void this.refreshPresence(), PRESENCE_MS);
  }

  async onModuleDestroy() {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    for (const connection of this.connections.values()) connection.socket.close(1001, "Server stopping");
    this.wss?.close();
    await this.subscriber?.quit().catch(() => undefined);
  }

  private connected(socket: WebSocket) {
    const connection: Connection = { id: randomUUID(), allowance: MESSAGE_BURST, lastMessageAt: Date.now(), socket, user: null, screen: null, setId: null, canLead: false, canOperate: false, accessCheckedAt: 0, queue: Promise.resolve(), watching: new Set(), presence: null, docs: new Map() };
    this.connections.set(connection.id, connection);
    // A device that doesn't sign in soon is dropped.
    const signIn = setTimeout(() => {
      if (!connection.user && !connection.screen) socket.close(4001, "Sign in first");
    }, 10_000);
    socket.on("message", (data) => {
      const now = Date.now();
      connection.allowance = Math.min(MESSAGE_BURST, connection.allowance + ((now - connection.lastMessageAt) / 1000) * MESSAGES_PER_SECOND) - 1;
      connection.lastMessageAt = now;
      if (connection.allowance < 0) return socket.close(1008, "Too many messages");
      let message: SyncClientMessage;
      try {
        message = JSON.parse(String(data)) as SyncClientMessage;
      } catch {
        return this.send(connection, { type: "error", code: "bad-request", message: "Not JSON" });
      }
      const failed = (err: unknown) => {
        this.logger.warn(`Sync message failed: ${err instanceof Error ? err.message : String(err)}`);
        this.send(connection, { type: "error", code: "bad-request", message: "Something went wrong" });
      };
      // The clock's pings at once, so they measure the network and not the queue.
      if (message?.type === "ping") return void this.handle(connection, message).catch(failed);
      connection.queue = connection.queue.then(() => this.handle(connection, message)).catch(failed);
    });
    socket.on("close", () => {
      clearTimeout(signIn);
      this.connections.delete(connection.id);
      if (connection.setId) void this.leaveSet(connection);
      if (connection.presence) void this.setPresence(connection, null);
      for (const songVersionId of connection.docs.keys()) void this.leaveDoc(connection, songVersionId);
      if (connection.screen) void this.screenOnline(connection.screen.id, false);
    });
    socket.on("error", () => undefined);
  }

  private send(connection: Connection, message: SyncServerMessage) {
    if (connection.socket.readyState === connection.socket.OPEN) connection.socket.send(JSON.stringify(message));
  }

  private async handle(connection: Connection, message: SyncClientMessage) {
    // The clock first: answered at once, before anything else.
    if (message.type === "ping") {
      this.send(connection, { type: "pong", id: message.id, sent: message.sent, at: Date.now() });
      if (connection.screen) void this.screenOnline(connection.screen.id, true);
      // Pings keep coming while a device follows, so they carry the re-check.
      if (connection.setId) await this.stillAllowed(connection);
      return;
    }
    if (message.type === "hello") return this.signIn(connection, message.token);
    if (message.type === "screen") return this.signInScreen(connection, message.token);
    if (message.type === "report") return this.report(connection, message.report);
    // A screen only follows: it pings and reports, and that's all.
    if (connection.screen) return this.send(connection, { type: "error", code: "forbidden", message: "A screen only follows its set" });
    if (!connection.user) return this.send(connection, { type: "error", code: "unauthorized", message: "Sign in first" });
    switch (message.type) {
      case "join":
        return this.join(connection, message.setId);
      case "leave":
        return this.leaveSet(connection);
      case "lead":
        return this.lead(connection);
      case "screens":
        return this.takeScreens(connection, message.control);
      case "present":
        return this.presentFromOperator(connection, message.presenting, message.basedOn);
      case "presenter":
        return this.presenter(connection, message);
      case "update":
        return this.update(connection, message);
      case "stage":
        return this.stage(connection, message);
      case "end":
        return this.end(connection);
      case "watch":
        return this.watch(connection, message.songs);
      case "presence":
        return this.presence(connection, message);
      case "doc-join":
        return this.joinDoc(connection, message);
      case "doc-leave":
        return this.leaveDoc(connection, String(message.songVersionId));
      case "doc-update":
        return this.docUpdate(connection, message);
      case "doc-awareness":
        return this.docAwareness(connection, message);
      case "doc-saved":
        return this.docSaved(connection, message);
      case "doc-discard":
        return this.docDiscard(connection, String(message.songVersionId));
      default:
        return this.send(connection, { type: "error", code: "bad-request", message: "Unknown message" });
    }
  }

  /**
   * The songs whose notes the device shows (issue #27): each one it can
   * open - in its library, or through the set it's opened in - is watched,
   * the rest left out; it's told which.
   */
  private async watch(connection: Connection, songs: unknown) {
    if (!Array.isArray(songs) || songs.length > SYNC_WATCH_MAX) return this.send(connection, { type: "error", code: "bad-request", message: `Watch at most ${SYNC_WATCH_MAX} songs` });
    const watching = new Set<string>();
    for (const song of songs as { songVersionId?: unknown; setlistId?: unknown }[]) {
      const songVersionId = typeof song?.songVersionId === "string" ? song.songVersionId.slice(0, 64) : null;
      const setlistId = typeof song?.setlistId === "string" ? song.setlistId.slice(0, 64) : undefined;
      if (songVersionId && !watching.has(songVersionId) && (await this.notes.canWatch(connection.user!, songVersionId, setlistId))) watching.add(songVersionId);
    }
    connection.watching = watching;
    this.send(connection, { type: "watching", songVersionIds: [...watching] });
    // In a song it no longer watches: not there any more.
    if (connection.presence && !watching.has(connection.presence.songVersionId)) await this.setPresence(connection, null);
    // Who's in the songs it now watches.
    for (const songVersionId of watching) await this.sendPresence(connection, songVersionId);
  }

  /** Someone's activity in a song they watch: editing it, replying to one of its notes, or nothing. */
  private async presence(connection: Connection, message: Extract<SyncClientMessage, { type: "presence" }>) {
    const songVersionId = typeof message.songVersionId === "string" ? message.songVersionId : null;
    if (!songVersionId) return this.setPresence(connection, null);
    if (!connection.watching.has(songVersionId)) return this.send(connection, { type: "error", code: "forbidden", message: "Watch the song first" });
    if (message.doing !== "editing" && message.doing !== "replying") return this.send(connection, { type: "error", code: "bad-request", message: "doing must be editing or replying" });
    const noteId = message.doing === "replying" && typeof message.noteId === "string" ? message.noteId.slice(0, 64) : undefined;
    await this.setPresence(connection, { songVersionId, doing: message.doing, ...(noteId && { noteId }) });
  }

  private async setPresence(connection: Connection, next: Connection["presence"]) {
    const before = connection.presence;
    connection.presence = next;
    const field = `${this.instance}:${connection.id}`;
    if (before && before.songVersionId !== next?.songVersionId) {
      await redis().hdel(presenceKey(before.songVersionId), field).catch(() => undefined);
      await redis().publish(PRESENCE_CHANNEL, before.songVersionId).catch(() => undefined);
    }
    if (next) {
      await this.storePresence(connection);
      await redis().publish(PRESENCE_CHANNEL, next.songVersionId).catch(() => undefined);
    }
  }

  private async storePresence(connection: Connection) {
    const presence = connection.presence;
    if (!presence || !connection.user) return;
    const person: SongPresence & { at: number } = { userId: connection.user.id, name: connection.user.name, avatarUrl: connection.user.avatarUrl, doing: presence.doing, ...(presence.noteId && { noteId: presence.noteId }), at: Date.now() };
    await redis().hset(presenceKey(presence.songVersionId), `${this.instance}:${connection.id}`, JSON.stringify(person));
    await redis().expire(presenceKey(presence.songVersionId), SESSION_TTL_S);
  }

  /** Who's doing something in a song now: devices whose presence was refreshed lately (an instance that stopped is forgotten). */
  private async peopleIn(songVersionId: string): Promise<SongPresence[]> {
    const raw = await redis().hgetall(presenceKey(songVersionId));
    const now = Date.now();
    return Object.values(raw)
      .map((value) => JSON.parse(value) as SongPresence & { at: number })
      .filter((person) => now - person.at < PRESENCE_MS * 2)
      .map(({ at: _, ...person }) => person);
  }

  private async sendPresence(connection: Connection, songVersionId: string) {
    this.send(connection, { type: "presence", songVersionId, people: await this.peopleIn(songVersionId) });
  }

  /** Someone came, went, or does something else in a song: this instance's connections watching it are told. */
  private async presenceChanged(songVersionId: string) {
    const local = [...this.connections.values()].filter((connection) => connection.watching.has(songVersionId));
    if (local.length === 0) return;
    const people = await this.peopleIn(songVersionId);
    for (const connection of local) this.send(connection, { type: "presence", songVersionId, people });
  }

  /** Some people's notifications changed: their connections here are told (any signed-in connection). */
  private notificationsChanged(raw: string) {
    let userIds: string[];
    try {
      userIds = JSON.parse(raw) as string[];
    } catch {
      return;
    }
    const told = new Set(userIds);
    for (const connection of this.connections.values()) if (connection.user && told.has(connection.user.id)) this.send(connection, { type: "notifications" });
  }

  /** A song was saved: this instance's connections watching it are told by whom, and its revision now. */
  private songSaved(raw: string) {
    let saved: SongSaved;
    try {
      saved = JSON.parse(raw) as SongSaved;
    } catch {
      return;
    }
    for (const connection of this.connections.values()) {
      if (connection.watching.has(saved.songVersionId)) this.send(connection, { type: "song", ...saved });
    }
    // Typed in together here: a save its members don't say was theirs came from elsewhere (a restore, an accepted suggestion…).
    if ([...this.connections.values()].some((connection) => connection.docs.has(saved.songVersionId))) {
      setTimeout(() => void this.outsideSave(saved.songVersionId, saved.revision).catch(() => undefined), OUTSIDE_SAVE_MS);
    }
  }

  /** A song's notes changed: this instance's connections watching it are told. */
  private notesChanged(songVersionId: string) {
    for (const connection of this.connections.values()) if (connection.watching.has(songVersionId)) this.send(connection, { type: "notes", songVersionId });
  }

  // --- Typing together (issue #27): a song's shared document, kept by doc-room.ts

  private member(connection: Connection): string {
    return `${this.instance}:${connection.id}`;
  }

  /** The song, if co-editing is on and the connection may change it; else why not. */
  private async mayType(connection: Connection, songVersionId: string): Promise<"off" | "forbidden" | null> {
    if (!(await liveCoEditingEnabled())) return "off";
    const song = await this.prisma.client.songVersion.findUnique({ where: { id: songVersionId }, select: { id: true, ownerScope: true, ownerUserId: true, ownerTeamId: true } });
    const user = await this.prisma.client.user.findUnique({ where: { id: connection.user!.id }, select: { bannedAt: true, deletedAt: true } });
    if (!song || !user || user.bannedAt || user.deletedAt || !(await this.policy.canEditContent(connection.user!, song))) return "forbidden";
    return null;
  }

  /** Still in the room, its right looked up again now and then; out of it (and told) when it's lost. */
  private async inDoc(connection: Connection, songVersionId: string): Promise<boolean> {
    const checkedAt = connection.docs.get(songVersionId);
    if (checkedAt === undefined) {
      // Not (or no longer) in it: start over.
      this.send(connection, { type: "doc-reset", songVersionId });
      return false;
    }
    if (Date.now() - checkedAt < ACCESS_RECHECK_MS) return true;
    connection.docs.set(songVersionId, Date.now());
    const refused = await this.mayType(connection, songVersionId);
    if (!refused) return true;
    await this.leaveDoc(connection, songVersionId);
    this.send(connection, { type: "doc-refused", songVersionId, reason: refused });
    return false;
  }

  private async joinDoc(connection: Connection, message: Extract<SyncClientMessage, { type: "doc-join" }>) {
    const songVersionId = typeof message.songVersionId === "string" ? message.songVersionId.slice(0, 64) : "";
    if (!songVersionId || !Number.isInteger(message.revision) || message.revision < 0) return this.send(connection, { type: "error", code: "bad-request", message: "doc-join needs a song and its revision" });
    if (!connection.docs.has(songVersionId) && connection.docs.size >= DOC_ROOMS_MAX) return this.send(connection, { type: "error", code: "bad-request", message: `Type in at most ${DOC_ROOMS_MAX} songs at once` });
    const refused = await this.mayType(connection, songVersionId);
    if (refused) return this.send(connection, { type: "doc-refused", songVersionId, reason: refused });
    // A member before the state is read: an update that comes meanwhile isn't missed (Yjs takes it in any order).
    connection.docs.set(songVersionId, Date.now());
    const room = await joinRoom(songVersionId, this.member(connection), message.revision);
    // What the others had was behind the song: they start over too.
    if (room.dropped) await announce({ songVersionId, kind: "reset" });
    this.send(connection, { type: "doc-state", songVersionId, state: room.state, seed: room.seed, revision: room.revision });
    for (const update of room.awareness) this.send(connection, { type: "doc-awareness", songVersionId, update });
  }

  private async leaveDoc(connection: Connection, songVersionId: string) {
    if (!connection.docs.delete(songVersionId)) return;
    const gone = await leaveRoom(songVersionId, this.member(connection), PRESENCE_MS * 2);
    if (gone) await announce({ songVersionId, kind: "awareness", from: this.member(connection), update: gone });
  }

  private async docUpdate(connection: Connection, message: Extract<SyncClientMessage, { type: "doc-update" }>) {
    const songVersionId = String(message.songVersionId);
    if (typeof message.update !== "string" || message.update.length > SYNC_DOC_UPDATE_MAX || !validUpdate(message.update)) return this.send(connection, { type: "error", code: "bad-request", message: "Invalid document update" });
    if (!(await this.inDoc(connection, songVersionId))) return;
    if (!(await appendUpdate(songVersionId, this.member(connection), message.update, message.seed === true))) {
      // A seed it wasn't picked for, or a room that was reset: load the song and join again.
      connection.docs.delete(songVersionId);
      return this.send(connection, { type: "doc-reset", songVersionId });
    }
    await announce({ songVersionId, kind: "update", from: this.member(connection), update: message.update });
  }

  private async docAwareness(connection: Connection, message: Extract<SyncClientMessage, { type: "doc-awareness" }>) {
    const songVersionId = String(message.songVersionId);
    if (typeof message.update !== "string" || message.update.length > 8 * 1024 || !validAwareness(message.update)) return this.send(connection, { type: "error", code: "bad-request", message: "Invalid awareness" });
    if (!connection.docs.has(songVersionId)) return;
    await touchMember(songVersionId, this.member(connection), message.update);
    await announce({ songVersionId, kind: "awareness", from: this.member(connection), update: message.update });
  }

  /** A member saved the song: the room is at that revision (as the database says), and a save it heard isn't from elsewhere. */
  private async docSaved(connection: Connection, message: Extract<SyncClientMessage, { type: "doc-saved" }>) {
    const songVersionId = String(message.songVersionId);
    if (!Number.isInteger(message.revision) || !(await this.inDoc(connection, songVersionId))) return;
    const rows = await this.prisma.client.$queryRaw<{ revision: number | null }[]>`select ("documentJson"->>'revision')::int as revision from "SongVersion" where id = ${songVersionId}`;
    if (rows[0]?.revision === message.revision) await roomSaved(songVersionId, message.revision);
  }

  /** Drops what nobody saved, for everyone in the song. */
  private async docDiscard(connection: Connection, songVersionId: string) {
    if (!(await this.inDoc(connection, songVersionId))) return;
    await resetRoom(songVersionId);
  }

  /** A save the room's members didn't say was theirs: the room starts over from the song as saved (once, whichever instance gets there). */
  private async outsideSave(songVersionId: string, revision: number) {
    const current = await roomRevision(songVersionId);
    if (current === null || current >= revision) return;
    if (await claimReset(songVersionId, revision)) await resetRoom(songVersionId);
  }

  /** A room's update, awareness or reset: this instance's members are told (an update not back to who sent it). */
  private docAnnounced(raw: string) {
    let message: DocAnnouncement;
    try {
      message = JSON.parse(raw) as DocAnnouncement;
    } catch {
      return;
    }
    for (const connection of this.connections.values()) {
      if (!connection.docs.has(message.songVersionId)) continue;
      if (message.kind === "reset") {
        connection.docs.delete(message.songVersionId);
        this.send(connection, { type: "doc-reset", songVersionId: message.songVersionId });
      } else if (message.from !== this.member(connection)) {
        this.send(connection, { type: message.kind === "update" ? "doc-update" : "doc-awareness", songVersionId: message.songVersionId, update: message.update });
      }
    }
  }

  private async signIn(connection: Connection, token: string) {
    try {
      const payload = await this.jwt.verify(String(token));
      const user = payload.sub
        ? await this.prisma.client.user.findUnique({
            where: { id: payload.sub },
            select: { id: true, email: true, isGlobalAdmin: true, displayName: true, avatarUrl: true, bannedAt: true, deletedAt: true },
          })
        : null;
      if (!user || user.deletedAt || user.bannedAt) throw new Error("No such user");
      const { canReview } = await capabilitiesOf(this.prisma.client, user.id);
      connection.user = { id: user.id, email: user.email, isGlobalAdmin: user.isGlobalAdmin, isReviewer: canReview, name: user.displayName, avatarUrl: user.avatarUrl };
      this.send(connection, { type: "ready", userId: user.id, coEditing: await liveCoEditingEnabled() });
    } catch {
      this.send(connection, { type: "error", code: "unauthorized", message: "Invalid or expired token" });
    }
  }

  /** A screen signing in (issue #186): its token, then its set, joined at once. */
  private async signInScreen(connection: Connection, token: string) {
    const screen = await this.screens.byToken(String(token));
    if (!screen) return this.send(connection, { type: "error", code: "disconnected", message: "This screen was disconnected" });
    connection.screen = { id: screen.id, name: screen.name, mode: screen.mode, setId: screen.setlistId };
    connection.accessCheckedAt = Date.now();
    void this.screenOnline(screen.id, true);
    this.send(connection, { type: "screen", screen: connection.screen });
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
  private async report(connection: Connection, input: unknown) {
    if (!connection.screen) return this.send(connection, { type: "error", code: "forbidden", message: "Only a screen reports" });
    const now = Date.now();
    if (connection.reportedAt && now - connection.reportedAt < SCREEN_REPORT_MIN_GAP_MS) return;
    const report = readScreenReport(input);
    if (!report) return this.send(connection, { type: "error", code: "bad-request", message: "Not a screen report" });
    connection.reportedAt = now;
    try {
      await redis().set(screenReportKey(connection.screen.id), JSON.stringify({ ...report, at: new Date(now).toISOString() }), "EX", SCREEN_REPORT_TTL_S);
    } catch {
      // Only for show, as whether it's online.
    }
  }

  /** Whether a screen is connected (issue #267), for Screens to show: set with each of its pings, gone when it goes. */
  private async screenOnline(screenId: string, online: boolean) {
    try {
      if (online) await redis().set(screenOnlineKey(screenId), "1", "EX", SCREEN_ONLINE_TTL_S);
      // Another connection of the same screen (a reload) renews it with its next ping.
      else await redis().del(screenOnlineKey(screenId));
    } catch {
      // Only for show: the screen works without it.
    }
  }

  /** A screen changed or was deleted (announced by ScreensService): its connections here are told, moved or dropped. */
  private async screenChanged(screenId: string) {
    const mine = [...this.connections.values()].filter((connection) => connection.screen?.id === screenId);
    if (mine.length === 0) return;
    const screen = await this.prisma.client.screen.findUnique({ where: { id: screenId }, select: { id: true, name: true, mode: true, setlistId: true } });
    for (const connection of mine) await this.refreshScreen(connection, screen);
  }

  private async refreshScreen(connection: Connection, screen: { id: string; name: string; mode: "LYRICS" | "CHART"; setlistId: string | null } | null) {
    if (!screen) {
      await this.leaveSet(connection);
      this.send(connection, { type: "error", code: "disconnected", message: "This screen was disconnected" });
      connection.socket.close(4003, "Disconnected");
      return;
    }
    const before = connection.screen;
    connection.screen = { id: screen.id, name: screen.name, mode: screen.mode, setId: screen.setlistId };
    this.send(connection, { type: "screen", screen: connection.screen });
    if (screen.setlistId !== connection.setId) {
      if (screen.setlistId) await this.joinAsScreen(connection, screen.setlistId);
      else await this.leaveSet(connection);
    } else if (before?.name !== screen.name && connection.setId) {
      await this.present(connection);
      await this.changed(connection.setId);
    }
  }

  private async join(connection: Connection, setId: string) {
    if (connection.setId) await this.leaveSet(connection);
    const set = typeof setId === "string" ? await this.prisma.client.setlist.findUnique({ where: { id: setId }, select: { id: true, ownerUserId: true, ownerTeamId: true } }) : null;
    const access = set ? await this.access.access(connection.user!, set) : null;
    if (!set || !access?.canView) return this.send(connection, { type: "error", code: "not-found", message: "Set not found" });
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
  private async stillAllowed(connection: Connection): Promise<boolean> {
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
    this.send(connection, { type: "error", code: "not-found", message: "Set not found" });
    return false;
  }

  private async leaveSet(connection: Connection) {
    const setId = connection.setId;
    if (!setId) return;
    connection.setId = null;
    // The operator gone: the screens are the leader's again (issue #275).
    await this.withSetLock(setId, async () => {
      const session = await this.read(setId);
      if (session?.screens?.conn === `${this.instance}:${connection.id}`) await redis().set(sessionKey(setId), JSON.stringify({ ...session, rev: session.rev + 1, screens: null }), "EX", SESSION_TTL_S);
    }).catch(() => undefined);
    await redis().hdel(membersKey(setId), `${this.instance}:${connection.id}`).catch(() => undefined);
    await this.changed(setId);
  }

  private async lead(connection: Connection) {
    const setId = connection.setId;
    if (!setId) return this.send(connection, { type: "error", code: "bad-request", message: "Join a set first" });
    if (!(await this.stillAllowed(connection))) return;
    if (!connection.canLead) return this.send(connection, { type: "error", code: "forbidden", message: "Only someone who can edit the set leads it" });
    await this.withSetLock(setId, async () => {
      const current = await this.read(setId);
      const session: StoredSession = {
        rev: (current?.rev ?? 0) + 1,
        leader: { id: connection.user!.id, name: connection.user!.name, conn: `${this.instance}:${connection.id}` },
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

  private async update(connection: Connection, message: Extract<SyncClientMessage, { type: "update" }>) {
    const setId = connection.setId;
    if (setId && !(await this.stillAllowed(connection))) return;
    if (!setId) return this.send(connection, { type: "error", code: "forbidden", message: "Only the leader changes the session" });
    await this.withSetLock(setId, () => this.updateLocked(connection, setId, message));
  }

  private async updateLocked(connection: Connection, setId: string, message: Extract<SyncClientMessage, { type: "update" }>) {
    const current = await this.read(setId);
    if (!current || !connection.canLead || current.leader.conn !== `${this.instance}:${connection.id}`) {
      return this.send(connection, { type: "error", code: "forbidden", message: "Only the leader changes the session" });
    }
    const next: StoredSession = { ...current, rev: current.rev + 1 };
    if (message.metronome !== undefined) {
      if (message.metronome !== null && !validMetronome(message.metronome)) return this.send(connection, { type: "error", code: "bad-request", message: "Invalid metronome" });
      next.metronome = message.metronome;
    }
    if (message.stems !== undefined) {
      if (message.stems !== null && !validStems(message.stems)) return this.send(connection, { type: "error", code: "bad-request", message: "Invalid stems" });
      next.stems = message.stems;
    }
    if (message.itemId !== undefined) next.itemId = typeof message.itemId === "string" ? message.itemId.slice(0, 64) : null;
    // Another item: its own timer, if it has one, starts (issue #269).
    if (next.itemId && next.itemId !== current.itemId) await this.itemTimer(setId, next.itemId).catch(() => undefined);
    if (message.presenting !== undefined) {
      if (message.presenting !== null && !validPresenting(message.presenting)) return this.send(connection, { type: "error", code: "bad-request", message: "Invalid presenting" });
      // Control locked to an operator (issues #275, #305): the leader's Live waits.
      if (current.screens?.exclusive && current.screens.conn !== `${this.instance}:${connection.id}`) return this.send(connection, { type: "error", code: "forbidden", message: `${current.screens.name} runs the screens` });
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
  private async takeScreens(connection: Connection, control: "shared" | "exclusive" | null) {
    const setId = connection.setId;
    if (!setId) return this.send(connection, { type: "error", code: "bad-request", message: "Join a set first" });
    if (!(await this.stillAllowed(connection))) return;
    if (!connection.canLead && !connection.canOperate) return this.send(connection, { type: "error", code: "forbidden", message: "Only someone who can edit the set, or runs screens, runs its screens" });
    if (control !== null && control !== "shared" && control !== "exclusive") return this.send(connection, { type: "error", code: "bad-request", message: "Invalid control" });
    await this.withSetLock(setId, () => this.takeScreensLocked(connection, setId, control));
  }

  private async takeScreensLocked(connection: Connection, setId: string, control: "shared" | "exclusive" | null) {
    const conn = `${this.instance}:${connection.id}`;
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
    if (control === null && current.screens?.conn !== conn) return;
    if (current.screens?.exclusive && current.screens.conn !== conn) return this.send(connection, { type: "error", code: "forbidden", message: `${current.screens.name} runs the screens` });
    await this.write(setId, { ...current, rev: current.rev + 1, screens: control === null ? null : { id: connection.user!.id, name: connection.user!.name, conn, exclusive: control === "exclusive" } });
  }

  /**
   * What the screens show (issues #275, #305), from anyone who may present -
   * unless control is locked to someone else. A command based on what the
   * screens no longer show is refused ("stale"), and the device is sent what
   * they show now.
   */
  private async presentFromOperator(connection: Connection, presenting: SyncPresenting | null, basedOn: unknown) {
    const setId = connection.setId;
    if (setId && !(await this.stillAllowed(connection))) return;
    if (!setId) return this.send(connection, { type: "error", code: "bad-request", message: "Join a set first" });
    if (presenting !== null && !validPresenting(presenting)) return this.send(connection, { type: "error", code: "bad-request", message: "Invalid presenting" });
    if (basedOn !== undefined && !(Number.isInteger(basedOn) && (basedOn as number) >= 0)) return this.send(connection, { type: "error", code: "bad-request", message: "basedOn must be a revision" });
    await this.withSetLock(setId, async () => {
      const current = await this.read(setId);
      if (!current) return this.send(connection, { type: "error", code: "forbidden", message: "Nobody's leading this set yet: take the screens first" });
      if (!this.mayPresent(connection, current)) {
        const locked = current.screens?.exclusive && current.screens.conn !== `${this.instance}:${connection.id}`;
        return this.send(connection, { type: "error", code: "forbidden", message: locked ? `${current.screens!.name} runs the screens` : "Take the screens first" });
      }
      if (this.stale(connection, current, basedOn as number | undefined)) return;
      if (samePresenting(current.presenting ?? null, presenting)) return;
      await this.write(setId, { ...current, rev: current.rev + 1, presenting, presentingRev: (current.presentingRev ?? 0) + 1 });
    });
  }

  /** The leader hands presenting to someone in the set, or takes it back (issue #305). */
  private async presenter(connection: Connection, message: Extract<SyncClientMessage, { type: "presenter" }>) {
    const setId = connection.setId;
    if (setId && !(await this.stillAllowed(connection))) return;
    if (!setId || typeof message.userId !== "string" || typeof message.allow !== "boolean") return this.send(connection, { type: "error", code: "bad-request", message: "Give a userId and allow" });
    await this.withSetLock(setId, async () => {
      const current = await this.read(setId);
      if (!current || current.leader.conn !== `${this.instance}:${connection.id}`) return this.send(connection, { type: "error", code: "forbidden", message: "Only the leader hands presenting to someone" });
      const presenters = (current.presenters ?? []).filter((one) => one.id !== message.userId);
      if (message.allow) {
        // Someone in the set now, by the name they're there with.
        const member = Object.values(await redis().hgetall(membersKey(setId)))
          .map((raw) => JSON.parse(raw) as { id: string; name: string; screen?: boolean })
          .find((one) => one.id === message.userId && !one.screen);
        if (!member) return this.send(connection, { type: "error", code: "bad-request", message: "They're not in the set" });
        if (presenters.length >= PRESENTERS_MAX) return this.send(connection, { type: "error", code: "bad-request", message: `Hand presenting to ${PRESENTERS_MAX} people at most` });
        presenters.push({ id: member.id, name: member.name });
      }
      await this.write(setId, { ...current, rev: current.rev + 1, presenters });
    });
  }

  /** Whether this device may present now (issue #305): it leads, runs screens by a role, can edit the set or was handed it - and control isn't locked to someone else. */
  private mayPresent(connection: Connection, session: StoredSession): boolean {
    const conn = `${this.instance}:${connection.id}`;
    if (!connection.user) return false;
    if (session.screens?.exclusive && session.screens.conn !== conn) return false;
    return connection.canLead || connection.canOperate || session.leader.conn === conn || !!session.presenters?.some((one) => one.id === connection.user!.id);
  }

  /** A command based on what the screens showed before the last change (issue #305): refused, with what they show now. */
  private stale(connection: Connection, current: StoredSession, basedOn: number | undefined): boolean {
    if (basedOn === undefined || basedOn === (current.presentingRev ?? 0)) return false;
    this.send(connection, { type: "error", code: "stale", message: "The screens moved on before this: here's what they show now" });
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
  private async stage(connection: Connection, message: Extract<SyncClientMessage, { type: "stage" }>) {
    const setId = connection.setId;
    if (!setId) return this.send(connection, { type: "error", code: "bad-request", message: "Join a set first" });
    if (!(await this.stillAllowed(connection))) return;
    if (!connection.canLead && !connection.canOperate) return this.send(connection, { type: "error", code: "forbidden", message: "Only someone who can edit the set, or runs screens, runs its screens" });
    const command: SyncStageCommand = { timer: message.timer, reset: message.reset === true, run: typeof message.run === "boolean" ? message.run : undefined, add: message.add, message: message.message, layers: message.layers };
    // A layer cleared stays cleared while the slide on screen now is (issue #280).
    const presenting = command.layers?.clear?.length ? ((await this.read(setId))?.presenting ?? null) : null;
    const next = applyStageCommand(await this.readStage(setId), command, Date.now(), presenting);
    if (!next) return this.send(connection, { type: "error", code: "bad-request", message: "Invalid timer, message or layers" });
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

  private async end(connection: Connection) {
    const setId = connection.setId;
    if (setId && !(await this.stillAllowed(connection))) return;
    if (!setId || !connection.canLead) return this.send(connection, { type: "error", code: "forbidden", message: "Only someone who can edit the set ends it" });
    await redis().del(sessionKey(setId));
    await this.changed(setId);
  }

  private async read(setId: string): Promise<StoredSession | null> {
    const raw = await redis().get(sessionKey(setId));
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  }

  private async write(setId: string, session: StoredSession) {
    await redis().set(sessionKey(setId), JSON.stringify(session), "EX", SESSION_TTL_S);
    await this.changed(setId);
  }

  /** Tells every instance (this one included) that a set's session or who's in it changed. */
  private async changed(setId: string) {
    await redis().publish(CHANNEL, setId);
  }

  private async present(connection: Connection) {
    if (!connection.setId || (!connection.user && !connection.screen)) return;
    const member = connection.screen
      ? { id: connection.screen.id, name: connection.screen.name, screen: true, at: Date.now() }
      : { id: connection.user!.id, name: connection.user!.name, at: Date.now() };
    await redis().hset(membersKey(connection.setId), `${this.instance}:${connection.id}`, JSON.stringify(member));
    await redis().expire(membersKey(connection.setId), SESSION_TTL_S);
  }

  private async refreshPresence() {
    for (const connection of this.connections.values()) {
      await this.present(connection).catch(() => undefined);
      await this.storePresence(connection).catch(() => undefined);
      for (const songVersionId of connection.docs.keys()) {
        await touchMember(songVersionId, this.member(connection)).catch(() => undefined);
        await keepRoom(songVersionId).catch(() => undefined);
      }
    }
  }

  /**
   * A set changed: its session sent again, after the one being sent. Run side
   * by side, an earlier read could reach the devices after a later one and
   * leave them on a stale session or stage (a layer the operator turned on,
   * never shown). One already waiting will read the latest: no second.
   */
  private queueBroadcast(setId: string) {
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
    const local = [...this.connections.values()].filter((connection) => connection.setId === setId);
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
          screens: stored.screens ? { id: stored.screens.id, name: stored.screens.name, exclusive: stored.screens.exclusive } : null,
        }
      : null;
    for (const connection of local) {
      this.send(connection, {
        type: "session",
        setId,
        session,
        members,
        leading: stored?.leader.conn === `${this.instance}:${connection.id}`,
        canLead: connection.canLead,
        stage,
        screensMine: !!stored?.screens && stored.screens.conn === `${this.instance}:${connection.id}`,
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
