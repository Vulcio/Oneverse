import type { AppNotification } from "@songverse/core";
import { Bell, CheckCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@songverse/ui/components/popover";
import { HostLink, usePlanning } from "../host";
import { NotificationList } from "./notification-list";

/** How often the badge asks for the unread count while the page is shown. */
const POLL_MS = 60_000;

/**
 * The bell in the top bar (issue #236): how many notifications are unread,
 * and the list of them, newest first, each opening what it's about. The
 * count is asked for every minute while the page is shown, and when it's
 * shown again.
 */
export function NotificationBell() {
  const { api, links } = usePlanning();
  const { t } = useTranslation();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [more, setMore] = useState(false);

  const refreshCount = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    api.getMyUnreadNotifications().then(({ unread: count }) => setUnread(count), () => {});
  }, [api]);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, POLL_MS);
    document.addEventListener("visibilitychange", refreshCount);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshCount);
    };
  }, [refreshCount]);

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
        <div className="max-h-96 overflow-y-auto">
          {items === null ? null : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("notifications.empty")}</p>
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
        {/* Everything, in pages (issue #149). */}
        <div className="border-t px-3 py-2 text-center">
          <HostLink href={links.notifications} className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setOpen(false)} data-testid="notification-see-all">
            {t("notifications.seeAll")}
          </HostLink>
        </div>
      </PopoverContent>
    </Popover>
  );
}
