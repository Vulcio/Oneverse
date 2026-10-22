import type { SongActivity, SyncScreenInfo, SyncServerMessage } from "@oneverse/core";
import type { WebSocket } from "ws";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";

// What the sync server's parts share (issue #314): a device's connection, and the timings they all keep to.

/** A session outlasts its leader's last change by this long, then goes. */
export const SESSION_TTL_S = 12 * 60 * 60;
/** A device's presence is refreshed this often, and forgotten when older than twice that (its API instance stopped). */
export const PRESENCE_MS = 20_000;
/**
 * How long a connection's right to its set is trusted before it's looked up
 * again (issue #112): someone taken off the set, no longer allowed to edit
 * it, or banned stops hearing it or leading it within this, not only when
 * they reconnect.
 */
export const ACCESS_RECHECK_MS = 30_000;

export interface Connection {
  id: string;
  /** Messages it may still send before it's dropped. */
  allowance: number;
  lastMessageAt: number;
  socket: WebSocket;
  user: (AuthenticatedUser & { name: string; avatarUrl: string | null }) | null;
  /** A screen (issue #186), signed in by its own token: it follows its set, never leads. */
  screen: SyncScreenInfo | null;
  setId: string | null;
  /** The device it says it is, with its person (`d:<userId>:<deviceId>`, issue #247); left out: it holds things by connection. */
  device?: string;
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

/** The gateway, as its parts (a set's session, watched songs, co-editing) reach it: this instance's connections, and sending to one. */
export interface SyncHub {
  /** This API instance, as it marks the connections it keeps in Redis. */
  readonly instance: string;
  /** This instance's connections. */
  connections(): Iterable<Connection>;
  send(connection: Connection, message: SyncServerMessage): void;
  /** A connection as Redis knows it, across instances: `instance:id`. */
  member(connection: Connection): string;
}
