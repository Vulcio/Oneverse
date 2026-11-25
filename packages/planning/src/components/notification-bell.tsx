import type { AppNotification } from "@oneverse/core";
import { Bell, BellOff, CheckCheck, Settings, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@oneverse/ui/components/popover";
import { HostLink, usePlanning } from "../host";
import { NotificationList } from "./notification-list";
import { hidePushPrompt, usePushDevice, usePushPromptHidden } from "../use-push-device";
import { Empty } from "@oneverse/ui/components/empty";

/** How often the badge asks for the unread count while the page is shown. */
const POLL_MS = 60_000;

/**
 * The bell in the top bar (issue #236): how many notifications are unread,
 * and the list of them, newest first, each opening what it's about. The
 * count is asked for every minute while the page is shown, and when it's
 * shown again - and at once where the app hears it live (issue #27).
 */
export function NotificationBell() {
  const { api, links, watchNotifications } = usePlanning();
  const { t } = useTranslation();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [more, setMore] = useState(false);
  // The server's push key, asked for when the menu first opens (undefined until then).
  const [pushKey, setPushKey] = useState<string | null | undefined>(undefined);

  const refreshCount = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    api.getMyUnreadNotifications().then(({ unread: count }) => setUnread(count), () => {});
  }, [api]);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, POLL_MS);
    document.addEventListener("visibilitychange", refreshCount);
    // Live where the app can (issue #27): a notification coming, or read in another tab.
    const unwatch = watchNotifications?.(refreshCount);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshCount);
      unwatch?.();
    };
  }, [refreshCount, watchNotifications]);

  // The same number on the installed app's icon (issue #407), and none once they're read.
  useEffect(() => showUnreadOnIcon(unread), [unread]);

  useEffect(() => {
    if (!open || pushKey !== undefined) return;
    api.getMyNotificationPreferences().then((preferences) => setPushKey(preferences.pushKey), () => {});
  }, [open, pushKey, api]);

  useEffect(() => {
    if (!open) return;
    void api.listMyNotifications().then((page) => {
      setItems(page.items);
      setMore(page.more);
      setUnread(page.unread);
    });
  }, [open, api]);

  const markRead = async (ids?: string[]) => {
    const { unread: count } = await api.markMyNotificationsRead(ids);
    setUnread(count);
    setItems((list) => list?.map((item) => (!ids || ids.includes(item.id) ? { ...item, read: true } : item)) ?? null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" className="relative" aria-label={unread ? `${t("notifications.open")} - ${t("notifications.unread", { count: unread })}` : t("notifications.open")} title={t("notifications.open")} data-testid="notification-bell" />}
      >
        <Bell />
        {unread > 0 ? (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground" data-testid="notification-count">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" data-testid="notification-list">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-sm font-medium">{t("notifications.title")}</span>
          <Button variant="ghost" size="sm" className="h-7" disabled={unread === 0} onClick={() => void markRead()} data-testid="notification-read-all">
            <CheckCheck />
            {t("notifications.markAllRead")}
          </Button>
        </div>
        <PushHereRow pushKey={pushKey} />
        <div className="max-h-96 overflow-y-auto">
          {items === null ? null : items.length === 0 ? (
            <Empty className="py-6">{t("notifications.empty")}</Empty>
          ) : (
            <NotificationList items={items} onRead={(ids) => void markRead(ids)} onOpened={() => setOpen(false)} />
          )}
          {more ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full rounded-none"
              onClick={() =>
                void api.listMyNotifications(items?.at(-1)?.id).then((page) => {
                  setItems((list) => [...(list ?? []), ...page.items]);
                  setMore(page.more);
                })
              }
            >
              {t("notifications.loadMore")}
            </Button>
          ) : null}
        </div>
        {/* Everything, in pages (issue #149); how they reach one (issue #568). */}
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <HostLink href={links.notificationSettings} className="flex items-center gap-1.5 text-sm underline-offset-2 hover:underline [&_svg]:size-4" onClick={() => setOpen(false)} data-testid="notification-settings-link">
            <Settings />
            {t("notifications.settingsLink")}
          </HostLink>
          <HostLink href={links.notifications} className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setOpen(false)} data-testid="notification-see-all">
            {t("notifications.seeAll")}
          </HostLink>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Get them on this device too" (issue #568), above the list while this
 * device could get notifications but doesn't: turned on here at once, or
 * hidden on this device by "Not now". Blocked in the browser, it says so
 * instead (only the person can allow them again). Nothing when they're on
 * here, or can't be.
 */
function PushHereRow({ pushKey }: { pushKey: string | null | undefined }) {
  const { links } = usePlanning();
  const { t } = useTranslation();
  const hidden = usePushPromptHidden();
  const push = usePushDevice(pushKey, pushKey !== undefined && !hidden);
  if (hidden || (push.state !== "off" && push.state !== "denied")) return null;
  if (push.state === "denied") {
    return (
      <div className="m-2 flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0" data-testid="push-here-denied">
        <BellOff />
        <span>
          {t("notifications.pushDenied")}{" "}
          <HostLink href={links.notificationSettings} className="text-foreground underline underline-offset-2">
            {t("notifications.settingsLink")}
          </HostLink>
          {" · "}
          <button type="button" className="text-foreground underline underline-offset-2" onClick={hidePushPrompt}>
            {t("notifications.pushPromptHide")}
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="m-2 flex items-start gap-2.5 rounded-md bg-muted px-3 py-2.5 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0" data-testid="push-here">
      <Smartphone />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{t("notifications.pushPromptTitle")}</span>
        <span className="text-xs text-muted-foreground">{t("notifications.pushPromptHint")}</span>
        {push.error ? <span className="text-xs text-destructive">{push.error}</span> : null}
        <div className="mt-1.5 flex gap-1.5">
          <Button size="sm" className="h-7" disabled={push.busy} onClick={() => void push.turnOn()} data-testid="push-here-on">
            {t("notifications.pushPromptOn")}
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={hidePushPrompt} data-testid="push-here-later">
            {t("notifications.pushPromptLater")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The number on the installed app's icon (issue #407, Badging API): iPhone and iPad home screen apps (with notifications allowed), Chrome and Edge on computers, some Android launchers. */
function showUnreadOnIcon(count: number): void {
  if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) return;
  void (count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
}
