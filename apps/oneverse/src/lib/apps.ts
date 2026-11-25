import { publicEnvValue } from "@oneverse/app/public-env";
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
      teams: `${planning}/teams`,
      organizations: `${planning}/organizations`,
      team: (teamId) => `${planning}/teams/${teamId}`,
      organization: (organizationId) => `${planning}/organizations/${organizationId}`,
      organizationEvents: (organizationId) => `${planning}/organizations/${organizationId}/events`,
      notifications: `${planning}/notifications`,
      // The Notifications settings (issue #568): Plan's account page, or Songverse's dashboard where Plan isn't deployed.
      notificationSettings: plan ? `${plan}/account#notifications` : `${songverse}/dashboard#notifications`,
      notification: (url) => (/^https?:\/\//.test(url) ? url : `${PLAN_PATHS.test(url) ? planning : songverse}${url}`),
    },
    sets: { href: (setlistId) => `${songverse}/sets/${setlistId}`, canMake: false },
    // No service worker here: a device gets them from Plan or Songverse.
    devicePush: false,
  };
}

