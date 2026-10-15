import { redis } from "../jobs/redis.js";

/** Where a song being saved is announced (issue #27), to every API instance: SyncServer tells the devices watching it. */
export const SONG_CHANNEL = "songverse:song:saved";

export interface SongSaved {
  songVersionId: string;
  revision: number;
  byId: string | null;
  by: string | null;
}

/**
 * Tells the devices watching a song it was saved. Called as the save's
 * transaction ends (its history entry is its last write), so it goes a
 * moment later: a device that reads the song at once finds it saved. A
 * Redis that's down mustn't fail the save.
 */
export function announceSongSaved(saved: SongSaved): void {
  setTimeout(() => {
    redis()
      .publish(SONG_CHANNEL, JSON.stringify(saved))
      .catch(() => undefined);
  }, 100);
}
