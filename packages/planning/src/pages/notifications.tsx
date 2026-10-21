import type { AppNotification } from "@oneverse/core";
import { CheckCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent } from "@oneverse/ui/components/card";
import { NotificationList } from "../components/notification-list";
import { usePlanning } from "../host";

/**
 * Everything someone was told (issue #149), newest first, a page at a time:
 * each opens what it's about, a request to connect is answered right there,
 * and all can be marked read at once. Old ones go by themselves (read after
 * 90 days, unread after a year).
 */
export function NotificationsPage() {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [more, setMore] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    void api.listMyNotifications(undefined, 50).then((page) => {
      setItems(page.items);
      setMore(page.more);
      setUnread(page.unread);
    });
  }, [api]);

  const markRead = async (ids?: string[]) => {
    const { unread: count } = await api.markMyNotificationsRead(ids);
    setUnread(count);
    setItems((list) => list?.map((item) => (!ids || ids.includes(item.id) ? { ...item, read: true } : item)) ?? null);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4" data-testid="notifications-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("notifications.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("notifications.pageDescription")}</p>
        </div>
        <Button variant="outline" size="sm" disabled={unread === 0} onClick={() => void markRead()} data-testid="notifications-read-all">
          <CheckCheck />
          {t("notifications.markAllRead")}
        </Button>
      </div>
      <Card className="py-0">
        <CardContent className="px-0">
          {items === null ? null : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("notifications.empty")}</p>
          ) : (
            <NotificationList items={items} onRead={(ids) => void markRead(ids)} />
          )}
          {more ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full rounded-none border-t"
              onClick={() =>
                void api.listMyNotifications(items?.at(-1)?.id, 50).then((page) => {
                  setItems((list) => [...(list ?? []), ...page.items]);
                  setMore(page.more);
                })
              }
              data-testid="notifications-more"
            >
              {t("notifications.loadMore")}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
