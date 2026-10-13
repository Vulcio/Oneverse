import { publicEnvValue } from "@songverse/app/public-env";
import type { PlanningHost } from "@songverse/planning/host";
import { apiClient } from "#/lib/api-client";

/** Songverse's address, where a date's set opens (SONGVERSE_URL); unset, sets aren't shown. */
export function songverseUrl(): string | null {
  const value = publicEnvValue("SONGVERSE_URL")?.trim().replace(/\/+$/, "");
  if (!value) return null;
  // Given without its scheme ("app.songverse.one"): https.
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

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
    },
    sets: songverse ? { href: (setlistId) => `${songverse}/sets/${setlistId}`, canMake: false } : null,
  };
}
