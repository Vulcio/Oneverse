/**
 * Asks the API for an avatar sized for how it's displayed (doubled for
 * high-density screens). Only Songverse-hosted avatars can be resized; others
 * (e.g. a Google profile picture) are returned unchanged.
 */
export function sizedAvatarUrl(url: string, displayPx: number): string {
  if (!/\/(users|teams|songbooks)\/[^/]+\/avatar\/[^/?]+$/.test(url)) return url;
  return `${url}?size=${displayPx * 2}`;
}
