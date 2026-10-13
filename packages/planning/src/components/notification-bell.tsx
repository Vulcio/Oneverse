import { notificationText, type AppNotification, type Messages } from "@songverse/core";
import { useRouter } from "@tanstack/react-router";
import { Bell, CheckCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@songverse/ui/components/popover";
import { usePlanning } from "../host";
import { cn } from "@songverse/ui/lib/utils";

/** How often the badge asks for the unread count while the page is shown. */
const POLL_MS = 60_000;

/** "5 min ago", "yesterday": how long ago, in the reader's language. */
function ago(iso: string, language: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  for (const [unit, size] of [["day", 86_400], ["hour", 3600], ["minute", 60]] as const) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "minute");
}

/**
 * The bell in the top bar (issue #236): how many notifications are unread,
 * and the list of them, newest first, each opening what it's about. The
 * count is asked for every minute while the page is shown, and when it's
 * shown again.
 */
export function NotificationBell() {
  const { api, sets } = usePlanning();
  const { t, i18n } = useTranslation();
  const router = useRouter();
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

  // A path stored with the notification: the same in both apps (issue #241), but a
  // set's is Songverse's - opened there from Planiverse, My calendar without it.
  const openLink = (url: string) => {
    const setlistId = /^\/sets\/([^/?#]+)/.exec(url)?.[1];
    if (setlistId && !sets) return router.history.push("/calendar");
    const href = setlistId && sets ? sets.href(setlistId) : url;
    if (/^https?:\/\//.test(href)) window.location.href = href;
    else router.history.push(setlistId ? url : href);
  };

  const messages = i18n.getResourceBundle(i18n.language, "translation") as Messages;

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
            <ul className="divide-y">
              {items.map((item) => {
                const text = notificationText(item.kind, item.data, messages, i18n.language);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={cn("flex w-full gap-2 px-3 py-2 text-left hover:bg-muted", !item.read && "bg-primary/5")}
                      data-notification={item.kind}
                      data-read={item.read}
                      onClick={() => {
                        if (!item.read) void markRead([item.id]);
                        setOpen(false);
                        if (item.url) openLink(item.url);
                      }}
                    >
                      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-primary")} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm">{text.title}</span>
                        {text.body ? <span className="block text-xs text-muted-foreground">{text.body}</span> : null}
                        <span className="block text-xs text-muted-foreground">{ago(item.createdAt, i18n.language)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
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
      </PopoverContent>
    </Popover>
  );
}
