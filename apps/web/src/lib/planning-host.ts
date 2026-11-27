import { publicEnvValue } from "@oneverse/app/public-env";
import type { PlanningHost } from "@oneverse/planning/host";
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
    eventDate: (eventId, date) => `/events/${eventId}/${date}`,
    notifications: "/notifications",
    notificationSettings: "/settings/notifications",
    notification: (url) => url,
    // With Plan deployed (issue #551), events and event types are made there, in its Calendar.
    manageEvents: (of) => {
      const plan = publicEnvValue("PLANIVERSE_URL");
      return plan ? `${plan}/calendar?of=${encodeURIComponent(of)}&tab=events` : null;
    },
  },
  songverseTeamsOnly: true,
  sets: { href: (setlistId) => `/sets/${setlistId}`, canMake: true },
  // The bell, live (issue #27).
  watchNotifications,
};
