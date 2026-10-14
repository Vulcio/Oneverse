import { createFileRoute } from "@tanstack/react-router";
import { NotificationsPage } from "@songverse/planning/pages/notifications";

/** Everything one was told (issue #149). */
export const Route = createFileRoute("/_protected/notifications")({
  component: NotificationsPage,
});
