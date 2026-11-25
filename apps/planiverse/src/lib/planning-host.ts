import { oneverseUrl, publicEnvValue } from "@oneverse/app/public-env";
import { watchSet } from "@oneverse/app/set-watch";
import type { PlanningHost } from "@oneverse/planning/host";
import { apiClient } from "#/lib/api-client";

/** Songverse's address (SONGVERSE_URL), where a set plays; null on a server without it. */
function songverseUrl(): string | null {
  const value = publicEnvValue("SONGVERSE_URL")?.trim().replace(/\/+$/, "");
  if (!value) return null;
  // Given without its scheme ("app.songverse.one"): https.
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

/** The paths Planiverse has: a notification's path that isn't one opens in Songverse. */
/** A set's own address, which opens its running order in the Oneverse app (issue #521). */
const SET_PATH = /^\/sets\/[^/?#]+($|[?#])/;

const PLANIVERSE_PATHS = /^\/(calendar|events|teams|organizations|account|notifications)(\/|$|[?#])/;

/**
 * Planiverse's pages (issue #241); a set opens as its running order in the
 * Oneverse app (issue #521), with or without Songverse, and is made from
 * here too (issue #531).
 */
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
      eventDate: (eventId, date) => `/events/${eventId}/${date}`,
      notifications: "/notifications",
      notificationSettings: "/account#notifications",
      // Its own pages here, and a set's running order (/sets/:id redirects there); the rest (a song, People) in Songverse - or My calendar without it.
      notification: (url) => (PLANIVERSE_PATHS.test(url) || SET_PATH.test(url) ? url : songverse ? `${songverse}${url}` : "/calendar"),
    },
    sets: {
      href: (setlistId) => `${oneverseUrl()}/sets/${setlistId}`,
      canMake: true,
      ...(songverse && { songverse: (setlistId: string) => `${songverse}/sets/${setlistId}` }),
    },
    watchSet,
  };
}
