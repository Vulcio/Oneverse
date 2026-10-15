import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import { redis } from "../jobs/redis.js";

/**
 * A song's shared document while people type in it together (issue #27):
 * Yjs updates kept in Redis, so every API instance serves the same room.
 * The updates are a list, appended to atomically and merged into one now
 * and then; the room's revision is the song's as the room has it (its last
 * save); a lock picks the one device that starts the document from the song
 * it loaded. Nothing here reads the updates beyond merging them: the song
 * is saved by the devices, as it always was.
 */

/** A room nobody is in any more goes this long after the last one left (a reload finds it). */
export const ROOM_IDLE_S = 120;
/** A room people are in lasts this long without a change. */
export const ROOM_TTL_S = 12 * 60 * 60;
/** Updates merged into one once there are more than this. */
const COMPACT_AT = 200;

export const DOC_CHANNEL = "songverse:doc:changed";

const updatesKey = (id: string) => `songverse:ydoc:${id}:updates`;
const revisionKey = (id: string) => `songverse:ydoc:${id}:revision`;
const seedKey = (id: string) => `songverse:ydoc:${id}:seed`;
const membersKey = (id: string) => `songverse:ydoc:${id}:members`;
const compactKey = (id: string) => `songverse:ydoc:${id}:compact`;
const roomKeys = (id: string) => [updatesKey(id), revisionKey(id), seedKey(id), membersKey(id)];

/** Said on DOC_CHANNEL to every instance: an update or awareness to relay to the room's members (not back to `from`), or the room reset. */
export type DocAnnouncement =
  | { songVersionId: string; kind: "update" | "awareness"; from: string; update: string }
  | { songVersionId: string; kind: "reset" };

/** A member, by connection: when it was last seen, and its latest awareness (its caret, its name) for who joins after. */
interface Member {
  at: number;
  awareness?: string;
}

// Appends an update: a seed only by the device holding the lock, into an empty room; any other only into a room that has its start.
const APPEND = `
if ARGV[2] == '1' then
  if redis.call('GET', KEYS[2]) ~= ARGV[3] or redis.call('LLEN', KEYS[1]) > 0 then return -1 end
  redis.call('DEL', KEYS[2])
elseif redis.call('LLEN', KEYS[1]) == 0 then return -1 end
local n = redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('EXPIRE', KEYS[3], ARGV[4])
return n`;

// The room's revision moves forward only.
const SAVED = `
if redis.call('LLEN', KEYS[1]) == 0 then return 0 end
local current = tonumber(redis.call('GET', KEYS[2]) or '0')
if current >= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
return 1`;

export interface JoinedRoom {
  /** The document so far, or null: `seed` says whether this device starts it. */
  state: string | null;
  seed: boolean;
  revision: number;
  /** The others' awareness, to show their carets at once. */
  awareness: string[];
  /** The room was older than the song this device loaded: dropped, its members to be told. */
  dropped: boolean;
}

/** Joins a song's room with the revision the device loaded. */
export async function joinRoom(songVersionId: string, member: string, revision: number): Promise<JoinedRoom> {
  const r = redis();
  let dropped = false;
  const [roomRevision, length] = await Promise.all([r.get(revisionKey(songVersionId)), r.llen(updatesKey(songVersionId))]);
  // Saved since the room started, and the room never heard of it: what it has is behind the song.
  if (length > 0 && Number(roomRevision ?? 0) < revision) {
    await r.del(updatesKey(songVersionId), revisionKey(songVersionId), seedKey(songVersionId));
    dropped = true;
  }
  await r.hset(membersKey(songVersionId), member, JSON.stringify({ at: Date.now() } satisfies Member));
  await keepRoom(songVersionId);
  const awareness = await othersAwareness(songVersionId, member);
  if (dropped || length === 0) {
    const seed = (await r.set(seedKey(songVersionId), member, "EX", 10, "NX")) === "OK";
    if (seed) await r.set(revisionKey(songVersionId), String(revision), "EX", ROOM_TTL_S);
    return { state: null, seed, revision: seed ? revision : Number((await r.get(revisionKey(songVersionId))) ?? revision), awareness, dropped };
  }
  const updates = await compact(songVersionId);
  return { state: updates.length ? Buffer.from(Y.mergeUpdates(updates)).toString("base64") : null, seed: false, revision: Number(roomRevision ?? revision), awareness, dropped };
}

/** The updates so far; merged into one first when there are many (one instance at a time). */
async function compact(songVersionId: string): Promise<Uint8Array[]> {
  const r = redis();
  const raw = await r.lrange(updatesKey(songVersionId), 0, -1);
  const updates = raw.map((one) => new Uint8Array(Buffer.from(one, "base64")));
  if (updates.length <= COMPACT_AT || (await r.set(compactKey(songVersionId), "1", "EX", 10, "NX")) !== "OK") return updates;
  try {
    const merged = Buffer.from(Y.mergeUpdates(updates)).toString("base64");
    // What was read becomes one; what came meanwhile stays after it.
    await r.multi().ltrim(updatesKey(songVersionId), updates.length, -1).lpush(updatesKey(songVersionId), merged).expire(updatesKey(songVersionId), ROOM_TTL_S).exec();
    return [new Uint8Array(Buffer.from(merged, "base64"))];
  } finally {
    await r.del(compactKey(songVersionId));
  }
}

/**
 * Adds a device's update to the room: false when it can't go in (a seed
 * from a device that wasn't picked, or a change to a room that was reset) -
 * the device loads the song and joins again.
 */
export async function appendUpdate(songVersionId: string, member: string, update: string, seed: boolean): Promise<boolean> {
  const n = (await redis().eval(APPEND, 3, updatesKey(songVersionId), seedKey(songVersionId), revisionKey(songVersionId), update, seed ? "1" : "0", member, String(ROOM_TTL_S))) as number;
  if (n < 0) return false;
  if (n > COMPACT_AT * 2) void compact(songVersionId).catch(() => undefined);
  return true;
}

/** A member saved the song (its revision checked against the database by the caller): the room is at that revision now. */
export async function roomSaved(songVersionId: string, revision: number): Promise<void> {
  await redis().eval(SAVED, 2, updatesKey(songVersionId), revisionKey(songVersionId), String(revision), String(ROOM_TTL_S));
}

/** The room's revision, or null when there's no room. */
export async function roomRevision(songVersionId: string): Promise<number | null> {
  const [revision, length] = await Promise.all([redis().get(revisionKey(songVersionId)), redis().llen(updatesKey(songVersionId))]);
  return length > 0 ? Number(revision ?? 0) : null;
}

/** Drops the room: its members load the song again and start over. */
export async function resetRoom(songVersionId: string): Promise<void> {
  await redis().del(...roomKeys(songVersionId).filter((key) => key !== membersKey(songVersionId)));
  await announce({ songVersionId, kind: "reset" });
}

/** Only one instance resets a room for a given save. */
export async function claimReset(songVersionId: string, revision: number): Promise<boolean> {
  return (await redis().set(`songverse:ydoc:${songVersionId}:reset:${revision}`, "1", "EX", 30, "NX")) === "OK";
}

export async function announce(message: DocAnnouncement): Promise<void> {
  await redis().publish(DOC_CHANNEL, JSON.stringify(message));
}

/** Keeps a member's latest awareness, and that it's still there. */
export async function touchMember(songVersionId: string, member: string, awareness?: string): Promise<void> {
  const r = redis();
  let current: Member = { at: Date.now() };
  if (awareness === undefined) {
    const raw = await r.hget(membersKey(songVersionId), member);
    if (raw) current = { ...(JSON.parse(raw) as Member), at: Date.now() };
  } else current.awareness = awareness;
  await r.hset(membersKey(songVersionId), member, JSON.stringify(current));
}

/** Keeps a room people are in from going. */
export async function keepRoom(songVersionId: string): Promise<void> {
  const r = redis();
  await Promise.all(roomKeys(songVersionId).filter((key) => key !== seedKey(songVersionId)).map((key) => r.expire(key, ROOM_TTL_S)));
}

/**
 * A member leaves: its caret goes from the others' screens (the awareness
 * that removes it, to announce), and a room nobody's in any more goes a
 * little later.
 */
export async function leaveRoom(songVersionId: string, member: string, freshMs: number): Promise<string | null> {
  const r = redis();
  const raw = await r.hget(membersKey(songVersionId), member);
  await r.hdel(membersKey(songVersionId), member);
  const others = await r.hgetall(membersKey(songVersionId));
  const now = Date.now();
  if (!Object.values(others).some((value) => now - (JSON.parse(value) as Member).at < freshMs)) {
    await Promise.all(roomKeys(songVersionId).map((key) => r.expire(key, ROOM_IDLE_S)));
  }
  const awareness = raw ? (JSON.parse(raw) as Member).awareness : undefined;
  return awareness ? awarenessGone(awareness) : null;
}

async function othersAwareness(songVersionId: string, member: string): Promise<string[]> {
  const all = await redis().hgetall(membersKey(songVersionId));
  return Object.entries(all)
    .filter(([key]) => key !== member)
    .map(([, value]) => (JSON.parse(value) as Member).awareness)
    .filter((awareness): awareness is string => !!awareness);
}

/** Whether a device's update is one Yjs can read (one that isn't would break everyone's document). */
export function validUpdate(update: string): boolean {
  try {
    Y.decodeUpdate(new Uint8Array(Buffer.from(update, "base64")));
    return true;
  } catch {
    return false;
  }
}

/**
 * The awareness update that takes away the clients in `update` (y-protocols'
 * encoding: how many, then each one's id, clock and state as JSON; a state
 * of null, one clock on, removes it).
 */
export function awarenessGone(update: string): string | null {
  try {
    const decoder = decoding.createDecoder(new Uint8Array(Buffer.from(update, "base64")));
    const count = decoding.readVarUint(decoder);
    const clients: { id: number; clock: number }[] = [];
    for (let i = 0; i < count; i++) {
      const id = decoding.readVarUint(decoder);
      const clock = decoding.readVarUint(decoder);
      decoding.readVarString(decoder);
      clients.push({ id, clock });
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, clients.length);
    for (const client of clients) {
      encoding.writeVarUint(encoder, client.id);
      encoding.writeVarUint(encoder, client.clock + 1);
      encoding.writeVarString(encoder, "null");
    }
    return Buffer.from(encoding.toUint8Array(encoder)).toString("base64");
  } catch {
    return null;
  }
}

/** Whether an awareness update reads as one (count, then id, clock, JSON each). */
export function validAwareness(update: string): boolean {
  return awarenessGone(update) !== null;
}
