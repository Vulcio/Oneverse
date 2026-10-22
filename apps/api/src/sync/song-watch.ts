import { SYNC_WATCH_MAX, type SongPresence, type SyncClientMessage } from "@oneverse/core";
import { redis } from "../jobs/redis.js";
import type { NotesService } from "../notes/notes.service.js";
import type { SongSaved } from "../song-versions/song-announce.js";
import { PRESENCE_MS, SESSION_TTL_S, type Connection, type SyncHub } from "./sync-connection.js";

/** Who's doing what in a song (issue #27), by connection; announced on PRESENCE_CHANNEL. */
const presenceKey = (songVersionId: string) => `songverse:presence:${songVersionId}`;
export const PRESENCE_CHANNEL = "songverse:presence:changed";

/**
 * The songs a device shows (issue #27): told when their notes change or
 * they're saved, and who's editing them or replying to one of their notes
 * (presence, kept in Redis by connection); and one's notifications changing.
 * The signals carry nothing: the device reads again with its own rights.
 */
export class SongWatch {
  constructor(
    private readonly hub: SyncHub,
    private readonly notes: NotesService,
  ) {}

  /**
   * The songs whose notes the device shows (issue #27): each one it can
   * open - in its library, or through the set it's opened in - is watched,
   * the rest left out; it's told which.
   */
  async watch(connection: Connection, songs: unknown) {
    if (!Array.isArray(songs) || songs.length > SYNC_WATCH_MAX) return this.hub.send(connection, { type: "error", code: "bad-request", message: `Watch at most ${SYNC_WATCH_MAX} songs` });
    const watching = new Set<string>();
    for (const song of songs as { songVersionId?: unknown; setlistId?: unknown }[]) {
      const songVersionId = typeof song?.songVersionId === "string" ? song.songVersionId.slice(0, 64) : null;
      const setlistId = typeof song?.setlistId === "string" ? song.setlistId.slice(0, 64) : undefined;
      if (songVersionId && !watching.has(songVersionId) && (await this.notes.canWatch(connection.user!, songVersionId, setlistId))) watching.add(songVersionId);
    }
    connection.watching = watching;
    this.hub.send(connection, { type: "watching", songVersionIds: [...watching] });
    // In a song it no longer watches: not there any more.
    if (connection.presence && !watching.has(connection.presence.songVersionId)) await this.setPresence(connection, null);
    // Who's in the songs it now watches.
    for (const songVersionId of watching) await this.sendPresence(connection, songVersionId);
  }

  /** Someone's activity in a song they watch: editing it, replying to one of its notes, or nothing. */
  async presence(connection: Connection, message: Extract<SyncClientMessage, { type: "presence" }>) {
    const songVersionId = typeof message.songVersionId === "string" ? message.songVersionId : null;
    if (!songVersionId) return this.setPresence(connection, null);
    if (!connection.watching.has(songVersionId)) return this.hub.send(connection, { type: "error", code: "forbidden", message: "Watch the song first" });
    if (message.doing !== "editing" && message.doing !== "replying") return this.hub.send(connection, { type: "error", code: "bad-request", message: "doing must be editing or replying" });
    const noteId = message.doing === "replying" && typeof message.noteId === "string" ? message.noteId.slice(0, 64) : undefined;
    await this.setPresence(connection, { songVersionId, doing: message.doing, ...(noteId && { noteId }) });
  }

  async setPresence(connection: Connection, next: Connection["presence"]) {
    const before = connection.presence;
    connection.presence = next;
    const field = `${this.hub.instance}:${connection.id}`;
    if (before && before.songVersionId !== next?.songVersionId) {
      await redis().hdel(presenceKey(before.songVersionId), field).catch(() => undefined);
      await redis().publish(PRESENCE_CHANNEL, before.songVersionId).catch(() => undefined);
    }
    if (next) {
      await this.storePresence(connection);
      await redis().publish(PRESENCE_CHANNEL, next.songVersionId).catch(() => undefined);
    }
  }

  async storePresence(connection: Connection) {
    const presence = connection.presence;
    if (!presence || !connection.user) return;
    const person: SongPresence & { at: number } = { userId: connection.user.id, name: connection.user.name, avatarUrl: connection.user.avatarUrl, doing: presence.doing, ...(presence.noteId && { noteId: presence.noteId }), at: Date.now() };
    await redis().hset(presenceKey(presence.songVersionId), `${this.hub.instance}:${connection.id}`, JSON.stringify(person));
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
    this.hub.send(connection, { type: "presence", songVersionId, people: await this.peopleIn(songVersionId) });
  }

  /** Someone came, went, or does something else in a song: this instance's connections watching it are told. */
  async presenceChanged(songVersionId: string) {
    const local = [...this.hub.connections()].filter((connection) => connection.watching.has(songVersionId));
    if (local.length === 0) return;
    const people = await this.peopleIn(songVersionId);
    for (const connection of local) this.hub.send(connection, { type: "presence", songVersionId, people });
  }

  /** Some people's notifications changed: their connections here are told (any signed-in connection). */
  notificationsChanged(raw: string) {
    let userIds: string[];
    try {
      userIds = JSON.parse(raw) as string[];
    } catch {
      return;
    }
    const told = new Set(userIds);
    for (const connection of this.hub.connections()) if (connection.user && told.has(connection.user.id)) this.hub.send(connection, { type: "notifications" });
  }

  /** A song was saved: this instance's connections watching it are told by whom, and its revision now. */
  songSaved(saved: SongSaved) {
    for (const connection of this.hub.connections()) {
      if (connection.watching.has(saved.songVersionId)) this.hub.send(connection, { type: "song", ...saved });
    }
  }

  /** A song's notes changed: this instance's connections watching it are told. */
  notesChanged(songVersionId: string) {
    for (const connection of this.hub.connections()) if (connection.watching.has(songVersionId)) this.hub.send(connection, { type: "notes", songVersionId });
  }
}
