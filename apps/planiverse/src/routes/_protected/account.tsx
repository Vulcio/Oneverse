import { createFileRoute } from "@tanstack/react-router";
import { MovedToSettings } from "@oneverse/app/components/moved-to-settings";

// Settings moved to one page (issue #540); old links and bookmarks land there, notifications' too.
export const Route = createFileRoute("/_protected/account")({
  component: () => <MovedToSettings moved={{ notifications: { section: "notifications" } }} />,
});
