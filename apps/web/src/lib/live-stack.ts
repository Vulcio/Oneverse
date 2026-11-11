import { deviceFlag } from "#/lib/device-store";

/**
 * Whether Live stacks a song that segues or transitions into the next one
 * on the same page (issue #214), on this device: on unless turned off.
 */
const stack = deviceFlag("songverse.live.stackSegues", true);

export const setStackSegues = stack.set;
export const useStackSegues = stack.use;
