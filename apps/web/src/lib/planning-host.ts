import type { PlanningHost } from "@songverse/planning/host";
import { apiClient } from "#/lib/api-client";
import { watchNotifications } from "#/lib/live-notes";

/** Where the planning screens (issue #241) find Songverse's pages and its sets. */
export const planningHost: PlanningHost = {
  api: apiClient,
  links: {
    home: "/dashboard",
    teams: "/teams",
    organizations: "/organizations",
    team: (teamId) => `/teams/${teamId}`,
    organization: (organizationId) => `/organizations/${organizationId}`,
    organizationEvents: (organizationId) => `/organizations/${organizationId}/events`,
    notifications: "/notifications",
    notification: (url) => url,
  },
  sets: { href: (setlistId) => `/sets/${setlistId}`, canMake: true },
  // The bell, live (issue #27).
  watchNotifications,
};
