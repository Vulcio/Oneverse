import type { PlanningHost } from "@songverse/planning/host";
import { apiClient } from "#/lib/api-client";

/** Where the planning screens (issue #241) find Songverse's pages and its sets. */
export const planningHost: PlanningHost = {
  api: apiClient,
  links: {
    organizations: "/organizations",
    team: (teamId) => `/teams/${teamId}`,
    organization: (organizationId) => `/organizations/${organizationId}`,
    organizationEvents: (organizationId) => `/organizations/${organizationId}/events`,
  },
  sets: { href: (setlistId) => `/sets/${setlistId}`, canMake: true },
};
