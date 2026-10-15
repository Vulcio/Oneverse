/** Announced when a screen changes (renamed, another mode, set or theme, deleted): the sync server tells it at once. */
export const SCREEN_CHANNEL = "songverse:sync:screen";

/** Set while a screen is connected to /sync (issue #267), renewed by its pings: Screens shows it as on. */
export const screenOnlineKey = (screenId: string) => `songverse:screen:online:${screenId}`;
/** A little over two of a screen's pings (every 10 s): gone soon after it is. */
export const SCREEN_ONLINE_TTL_S = 25;
