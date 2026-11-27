import { publicEnvValue } from "@oneverse/app/public-env";
import { watchSet } from "@oneverse/app/set-watch";
import type { PlanningHost } from "@oneverse/planning/host";
import { apiClient } from "#/lib/api-client";

/** An app's address from the environment, without its trailing slash; given without its scheme, https. Null when it isn't deployed. */
function appAddress(name: "SONGVERSE_URL" | "PLANIVERSE_URL" | "SCREEN_URL"): string | null {
  const value = publicEnvValue(name)?.trim().replace(/\/+$/, "");
  if (!value) return null;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

/**
 * The apps Oneverse's home (issue #538) leads to: Songverse always (its
 * address, or the local one in development), Plan (Planiverse until #539)
 * and the screen app's console when they're deployed.
 */
export function appAddresses() {
  return {
    songverse: appAddress("SONGVERSE_URL") ?? "http://localhost:3000",
    plan: appAddress("PLANIVERSE_URL"),
    screen: appAddress("SCREEN_URL"),
  };
}

/** The paths Plan has (as planiverse's planning-host.ts): a notification's path that isn't one opens in Songverse. */
/** The home's own pages a notification opens here: a date's (issue #575), a set's running order (issue #521). */
const HOME_PATHS = /^\/(events\/|teams(\/|$|[?#])|sets\/[^/?#]+($|[?#]))/;

const PLAN_PATHS = /^\/(calendar|teams|organizations|account|notifications)(\/|$|[?#])/;

/**
 * The planning screens' host here (issue #538): the home shows their parts -
 * the answers, the open places, the bell - and every page they lead to is
 * Plan's, or Songverse's where Plan isn't deployed (the same paths) or for a
 * song, a set or People.
 */
export function planningHost(): PlanningHost {
  const { songverse, plan } = appAddresses();
  const planning = plan ?? songverse;
  return {
    api: apiClient,
    links: {
      home: "/",
      // Teams are managed here (issue #550).
      teams: "/teams",
      organizations: `${planning}/organizations`,
      team: (teamId) => `/teams/${teamId}`,
      // A calendar is Plan's Calendar section, where Plan is deployed.
      ...(plan ? { calendar: (of: string) => (of === "me" ? `${plan}/calendar` : `${plan}/calendar?of=${encodeURIComponent(of)}`) } : {}),
      // A team's events and event types are made in Plan where it's deployed (issue #551), here otherwise.
      manageEvents: (of) => (plan ? `${plan}/calendar?of=${encodeURIComponent(of)}&tab=events` : null),
      organization: (organizationId) => `${planning}/organizations/${organizationId}`,
      organizationEvents: (organizationId) => `${planning}/organizations/${organizationId}/events`,
      // A date's page is the home's own (issue #575), as in Plan and Songverse.
      eventDate: (eventId, date) => `/events/${eventId}/${date}`,
      notifications: `${planning}/notifications`,
      // The Notifications settings (issues #568, #540): here, as in every app.
      notificationSettings: "/settings/notifications",
      notification: (url) => (/^https?:\/\//.test(url) || HOME_PATHS.test(url) ? url : `${PLAN_PATHS.test(url) ? planning : songverse}${url}`),
    },
    // A set opens here, as its running order (issue #521), and plays in Songverse.
    sets: { href: (setlistId) => `/sets/${setlistId}`, canMake: false, songverse: (setlistId) => `${songverse}/sets/${setlistId}` },
    watchSet,
    // No service worker here: a device gets them from Plan or Songverse.
    devicePush: false,
  };
}

