import { SYNC_DOC_UPDATE_MAX, type SyncClientMessage } from "@oneverse/core";
import type { AccessPolicyService } from "../access/access-policy.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { SongSaved } from "../song-versions/song-announce.js";
import { liveCoEditingEnabled } from "./collaboration-settings.js";
import { announce, appendUpdate, claimReset, joinRoom, keepRoom, leaveRoom, resetRoom, roomRevision, roomSaved, touchMember, validAwareness, validUpdate, type DocAnnouncement } from "./doc-room.js";
import { ACCESS_RECHECK_MS, PRESENCE_MS, type Connection, type SyncHub } from "./sync-connection.js";

/** Songs a connection types in at once (issue #27). */
const DOC_ROOMS_MAX = 3;
/** A save heard for a song with a room, not said by one of its members within this, came from elsewhere: the room starts over. */
const OUTSIDE_SAVE_MS = 3000;

/**
 * Typing together (issue #27): a song's shared document - Yjs updates passed
 * between the devices in it, kept by doc-room.ts - for who can change the
 * song, where Admin turned live co-editing on.
 */
export class CoEditing {
  constructor(
    private readonly hub: SyncHub,
    private readonly prisma: PrismaService,
    private readonly policy: AccessPolicyService,
  ) {}

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
      this.hub.send(connection, { type: "doc-reset", songVersionId });
      return false;
    }
    if (Date.now() - checkedAt < ACCESS_RECHECK_MS) return true;
    connection.docs.set(songVersionId, Date.now());
    const refused = await this.mayType(connection, songVersionId);
    if (!refused) return true;
    await this.leaveDoc(connection, songVersionId);
    this.hub.send(connection, { type: "doc-refused", songVersionId, reason: refused });
    return false;
  }

  async joinDoc(connection: Connection, message: Extract<SyncClientMessage, { type: "doc-join" }>) {
    const songVersionId = typeof message.songVersionId === "string" ? message.songVersionId.slice(0, 64) : "";
    if (!songVersionId || !Number.isInteger(message.revision) || message.revision < 0) return this.hub.send(connection, { type: "error", code: "bad-request", message: "doc-join needs a song and its revision" });
    if (!connection.docs.has(songVersionId) && connection.docs.size >= DOC_ROOMS_MAX) return this.hub.send(connection, { type: "error", code: "bad-request", message: `Type in at most ${DOC_ROOMS_MAX} songs at once` });
    const refused = await this.mayType(connection, songVersionId);
    if (refused) return this.hub.send(connection, { type: "doc-refused", songVersionId, reason: refused });
    // A member before the state is read: an update that comes meanwhile isn't missed (Yjs takes it in any order).
    connection.docs.set(songVersionId, Date.now());
    const room = await joinRoom(songVersionId, this.hub.member(connection), message.revision);
    // What the others had was behind the song: they start over too.
    if (room.dropped) await announce({ songVersionId, kind: "reset" });
    this.hub.send(connection, { type: "doc-state", songVersionId, state: room.state, seed: room.seed, revision: room.revision });
    for (const update of room.awareness) this.hub.send(connection, { type: "doc-awareness", songVersionId, update });
  }

  async leaveDoc(connection: Connection, songVersionId: string) {
    if (!connection.docs.delete(songVersionId)) return;
    const gone = await leaveRoom(songVersionId, this.hub.member(connection), PRESENCE_MS * 2);
    if (gone) await announce({ songVersionId, kind: "awareness", from: this.hub.member(connection), update: gone });
  }

  async docUpdate(connection: Connection, message: Extract<SyncClientMessage, { type: "doc-update" }>) {
    const songVersionId = String(message.songVersionId);
    if (typeof message.update !== "string" || message.update.length > SYNC_DOC_UPDATE_MAX || !validUpdate(message.update)) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Invalid document update" });
    if (!(await this.inDoc(connection, songVersionId))) return;
    if (!(await appendUpdate(songVersionId, this.hub.member(connection), message.update, message.seed === true))) {
      // A seed it wasn't picked for, or a room that was reset: load the song and join again.
      connection.docs.delete(songVersionId);
      return this.hub.send(connection, { type: "doc-reset", songVersionId });
    }
    await announce({ songVersionId, kind: "update", from: this.hub.member(connection), update: message.update });
  }

  async docAwareness(connection: Connection, message: Extract<SyncClientMessage, { type: "doc-awareness" }>) {
    const songVersionId = String(message.songVersionId);
    if (typeof message.update !== "string" || message.update.length > 8 * 1024 || !validAwareness(message.update)) return this.hub.send(connection, { type: "error", code: "bad-request", message: "Invalid awareness" });
    if (!connection.docs.has(songVersionId)) return;
    await touchMember(songVersionId, this.hub.member(connection), message.update);
    await announce({ songVersionId, kind: "awareness", from: this.hub.member(connection), update: message.update });
  }

  /** A member saved the song: the room is at that revision (as the database says), and a save it heard isn't from elsewhere. */
  async docSaved(connection: Connection, message: Extract<SyncClientMessage, { type: "doc-saved" }>) {
    const songVersionId = String(message.songVersionId);
    if (!Number.isInteger(message.revision) || !(await this.inDoc(connection, songVersionId))) return;
    const rows = await this.prisma.client.$queryRaw<{ revision: number | null }[]>`select ("documentJson"->>'revision')::int as revision from "SongVersion" where id = ${songVersionId}`;
    if (rows[0]?.revision === message.revision) await roomSaved(songVersionId, message.revision);
  }

  /** Drops what nobody saved, for everyone in the song. */
  async docDiscard(connection: Connection, songVersionId: string) {
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
  docAnnounced(raw: string) {
    let message: DocAnnouncement;
    try {
      message = JSON.parse(raw) as DocAnnouncement;
    } catch {
      return;
    }
    for (const connection of this.hub.connections()) {
      if (!connection.docs.has(message.songVersionId)) continue;
      if (message.kind === "reset") {
        connection.docs.delete(message.songVersionId);
        this.hub.send(connection, { type: "doc-reset", songVersionId: message.songVersionId });
      } else if (message.from !== this.hub.member(connection)) {
        this.hub.send(connection, { type: message.kind === "update" ? "doc-update" : "doc-awareness", songVersionId: message.songVersionId, update: message.update });
      }
    }
  }

  /** A song was saved: typed in together here, a save its members don't say was theirs came from elsewhere (a restore, an accepted suggestion…). */
  songSaved(saved: SongSaved) {
    if ([...this.hub.connections()].some((connection) => connection.docs.has(saved.songVersionId))) {
      setTimeout(() => void this.outsideSave(saved.songVersionId, saved.revision).catch(() => undefined), OUTSIDE_SAVE_MS);
    }
  }

  /** Still typing in its songs: its place in each room kept (see refreshPresence). */
  async keep(connection: Connection) {
    for (const songVersionId of connection.docs.keys()) {
      await touchMember(songVersionId, this.hub.member(connection)).catch(() => undefined);
      await keepRoom(songVersionId).catch(() => undefined);
    }
  }
}
