import { deviceFlag } from "@oneverse/ui/lib/device-store";

/**
 * Following the music (issue #501): the line being sung lit and kept in view
 * as the stems or the click play - in the chart, the Words view and the chord
 * grid. On by default; turned off on the device when it gets in the way (it
 * isn't always in time yet, issue #502).
 */
const follow = deviceFlag("songverse.followMusic", true);
export const setFollowMusic = follow.set;
export const useFollowMusic = follow.use;
