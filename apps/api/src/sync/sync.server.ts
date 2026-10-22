import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { SYNC_DOC_UPDATE_MAX, SYNC_PATH, type SyncClientMessage, type SyncServerMessage } from "@oneverse/core";
import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { JwtVerifierService } from "../auth/jwt-verifier.service.js";
import { redis } from "../jobs/redis.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { capabilitiesOf } from "../roles/capabilities.js";
import { SCREEN_CHANNEL, ScreensService } from "../screens/screens.service.js";
import { SetlistAccessService } from "../setlists/setlist-access.service.js";
import { NOTES_CHANNEL, NotesService } from "../notes/notes.service.js";
import { SONG_CHANNEL, type SongSaved } from "../song-versions/song-announce.js";
import { NOTIFICATIONS_CHANNEL } from "../notifications/notifications.service.js";
import { AccessPolicyService } from "../access/access-policy.service.js";
import { liveCoEditingEnabled } from "./collaboration-settings.js";
import { CoEditing } from "./co-editing.js";
import { DOC_CHANNEL } from "./doc-room.js";
import { CHANNEL, SetSessions } from "./set-sessions.js";
import { PRESENCE_CHANNEL, SongWatch } from "./song-watch.js";
import { PRESENCE_MS, type Connection, type SyncHub } from "./sync-connection.js";

/**
 * How many messages a connection may send (issue #112): a burst, refilled
 * each second. A device sends a few a second at most (pings, a leader's
 * changes); one that floods is dropped.
 */
const MESSAGE_BURST = 60;
const MESSAGES_PER_SECOND = 30;

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
 *
 * This class is the gateway (issue #314): connections, signing in, pings,
 * the rate limit, and each message and Redis announcement handed to its
 * part - a set's session and screens (set-sessions.ts), watched songs and
 * presence (song-watch.ts), typing together (co-editing.ts).
 */
@Injectable()
export class SyncServer implements OnModuleDestroy {
  private readonly logger = new Logger("Sync");
  private readonly instance = randomUUID();
  private readonly connections = new Map<string, Connection>();
  /** What its parts reach it through. */
  private readonly hub: SyncHub = {
    instance: this.instance,
    connections: () => this.connections.values(),
    send: (connection, message) => this.send(connection, message),
    member: (connection) => `${this.instance}:${connection.id}`,
  };
  private readonly sets: SetSessions;
  private readonly songs: SongWatch;
  private readonly coEditing: CoEditing;
  private wss: WebSocketServer | null = null;
  private subscriber: Redis | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly jwt: JwtVerifierService,
    private readonly prisma: PrismaService,
    access: SetlistAccessService,
    screens: ScreensService,
    notes: NotesService,
    policy: AccessPolicyService,
  ) {
    this.sets = new SetSessions(this.hub, prisma, access, screens);
    this.songs = new SongWatch(this.hub, notes);
    this.coEditing = new CoEditing(this.hub, prisma, policy);
  }

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
      if (channel === SCREEN_CHANNEL) void this.sets.screenChanged(id);
      else if (channel === NOTES_CHANNEL) this.songs.notesChanged(id);
      else if (channel === SONG_CHANNEL) this.songSaved(id);
      else if (channel === PRESENCE_CHANNEL) void this.songs.presenceChanged(id);
      else if (channel === NOTIFICATIONS_CHANNEL) this.songs.notificationsChanged(id);
      else if (channel === DOC_CHANNEL) this.coEditing.docAnnounced(id);
      else this.sets.queueBroadcast(id);
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
      // Dropped, not left: the screens wait for them a while.
      if (connection.setId) void this.sets.leaveSet(connection, true);
      if (connection.presence) void this.songs.setPresence(connection, null);
      for (const songVersionId of connection.docs.keys()) void this.coEditing.leaveDoc(connection, songVersionId);
      if (connection.screen) void this.sets.screenOnline(connection.screen.id, false);
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
      if (connection.screen) void this.sets.screenOnline(connection.screen.id, true);
      // Pings keep coming while a device follows, so they carry the re-check.
      if (connection.setId) await this.sets.stillAllowed(connection);
      return;
    }
    if (message.type === "hello") return this.signIn(connection, message.token);
    if (message.type === "screen") return this.sets.signInScreen(connection, message.token);
    if (message.type === "report") return this.sets.report(connection, message.report);
    // A screen only follows: it pings and reports, and that's all.
    if (connection.screen) return this.send(connection, { type: "error", code: "forbidden", message: "A screen only follows its set" });
    if (!connection.user) return this.send(connection, { type: "error", code: "unauthorized", message: "Sign in first" });
    switch (message.type) {
      case "join":
        return this.sets.join(connection, message.setId);
      case "leave":
        return this.sets.leaveSet(connection);
      case "lead":
        return this.sets.lead(connection);
      case "screens":
        return this.sets.takeScreens(connection, message.control);
      case "present":
        return this.sets.presentFromOperator(connection, message.presenting, message.basedOn);
      case "presenter":
        return this.sets.presenter(connection, message);
      case "update":
        return this.sets.update(connection, message);
      case "stage":
        return this.sets.stage(connection, message);
      case "end":
        return this.sets.end(connection);
      case "watch":
        return this.songs.watch(connection, message.songs);
      case "presence":
        return this.songs.presence(connection, message);
      case "doc-join":
        return this.coEditing.joinDoc(connection, message);
      case "doc-leave":
        return this.coEditing.leaveDoc(connection, String(message.songVersionId));
      case "doc-update":
        return this.coEditing.docUpdate(connection, message);
      case "doc-awareness":
        return this.coEditing.docAwareness(connection, message);
      case "doc-saved":
        return this.coEditing.docSaved(connection, message);
      case "doc-discard":
        return this.coEditing.docDiscard(connection, String(message.songVersionId));
      default:
        return this.send(connection, { type: "error", code: "bad-request", message: "Unknown message" });
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

  /** A song was saved: the devices watching it are told, and a room typing in it hears of a save from elsewhere. */
  private songSaved(raw: string) {
    let saved: SongSaved;
    try {
      saved = JSON.parse(raw) as SongSaved;
    } catch {
      return;
    }
    this.songs.songSaved(saved);
    this.coEditing.songSaved(saved);
  }

  /** Every PRESENCE_MS: this instance's connections still there - in their set, in the songs they're in, in the rooms they type in. */
  private async refreshPresence() {
    for (const connection of this.connections.values()) {
      await this.sets.present(connection).catch(() => undefined);
      await this.songs.storePresence(connection).catch(() => undefined);
      await this.coEditing.keep(connection);
    }
  }
}
