import type { AnnouncementAudience } from "@oneverse/core";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AnnouncementsCard, type AnnouncementsActions } from "@oneverse/planning/components/announcements-card";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/admin/announcements")({
  loader: () => apiClient.adminGetOrganizations(),
  component: AdminAnnouncementsPage,
});

/**
 * Admin > Announcements (issue #536): news for people - a new version (a
 * release drafts its own), new features - in English and French, for
 * everyone, Songverse's or Planiverse's people (when Planiverse is
 * deployed), or an organisation's members; sent as notifications.
 */
function AdminAnnouncementsPage() {
  const { t } = useTranslation();
  const { organizations, planiverseUrl } = Route.useLoaderData();
  const audiences: AnnouncementAudience[] = ["EVERYONE", ...(planiverseUrl ? (["SONGVERSE", "PLANIVERSE"] as const) : []), ...(organizations.length > 0 ? (["ORGANIZATION"] as const) : [])];
  const actions = useMemo<AnnouncementsActions>(
    () => ({
      list: () => apiClient.adminListAnnouncements(),
      create: (draft) => apiClient.adminCreateAnnouncement(draft),
      update: (id, draft) => apiClient.adminUpdateAnnouncement(id, draft),
      send: (id) => apiClient.adminSendAnnouncement(id),
      remove: (id) => apiClient.adminDeleteAnnouncement(id),
    }),
    [],
  );
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("announcements.title")}</h1>
      <AnnouncementsCard
        actions={actions}
        languages={["en", "fr"]}
        audiences={audiences}
        organizations={organizations.map((one) => ({ id: one.id, name: one.name }))}
        title={t("announcements.title")}
        description={t("announcements.description")}
      />
    </div>
  );
}
