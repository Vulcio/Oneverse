import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { NotificationSettingsCard } from "@songverse/planning/components/notification-settings-card";

export const Route = createFileRoute("/_protected/notifications")({
  component: NotificationsPage,
});

/** How each notification reaches one, and this device's (issue #241): turned on here, Planiverse's pushes come here. */
function NotificationsPage() {
  const { t } = useTranslation();
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("notifications.settingsTitle")}</h1>
      <NotificationSettingsCard />
    </div>
  );
}
