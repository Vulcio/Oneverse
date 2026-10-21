import { publicEnvValue } from "@oneverse/app/public-env";
import type { PlanningHost } from "@oneverse/planning/host";
import { apiClient } from "#/lib/api-client";

/** Songverse's address, where a date's set opens (SONGVERSE_URL); unset, sets aren't shown. */
export function songverseUrl(): string | null {
  const value = publicEnvValue("SONGVERSE_URL")?.trim().replace(/\/+$/, "");
  if (!value) return null;
  // Given without its scheme ("app.songverse.one"): https.
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

/** The paths Planiverse has: a notification's path that isn't one opens in Songverse. */
const PLANIVERSE_PATHS = /^\/(calendar|teams|organizations|account|notifications)(\/|$|[?#])/;

/** Planiverse's pages, and Songverse's sets, opened there - made only in Songverse (issue #241). */
export function planningHost(): PlanningHost {
  const songverse = songverseUrl();
  return {
    api: apiClient,
    links: {
      home: "/calendar",
      teams: "/teams",
      organizations: "/organizations",
      team: (teamId) => `/teams/${teamId}`,
      organization: (organizationId) => `/organizations/${organizationId}`,
      organizationEvents: (organizationId) => `/organizations/${organizationId}/events`,
      notifications: "/notifications",
      // Its own pages here; the rest (a set, a song, People) in Songverse - or My calendar without it.
      notification: (url) => (PLANIVERSE_PATHS.test(url) ? url : songverse ? `${songverse}${url}` : "/calendar"),
    },
    sets: songverse ? { href: (setlistId) => `${songverse}/sets/${setlistId}`, canMake: false } : null,
  };
}
