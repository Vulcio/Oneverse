import { redis } from "../jobs/redis.js";

/** Where a set changing is announced (issue #200), to every API instance: SyncServer tells the devices in it. */
export const SET_CHANNEL = "songverse:set:changed";

/**
 * Tells the devices in a set that it changed - its songs, their order, what
 * happens after one, its name - so they read it again at once. The signal
 * carries only the set's id. A Redis that's down mustn't fail the write.
 */
export async function announceSetChanged(setId: string): Promise<void> {
  await redis()
    .publish(SET_CHANNEL, setId)
    .catch(() => undefined);
}
