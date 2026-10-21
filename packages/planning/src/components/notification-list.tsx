import { ApiError, notificationText, type AppNotification, type Messages } from "@oneverse/core";
import { useRouter } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { cn } from "@oneverse/ui/lib/utils";
import { usePlanning } from "../host";

/** "5 min ago", "yesterday": how long ago, in the reader's language. */
export function ago(iso: string, language: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  for (const [unit, size] of [["day", 86_400], ["hour", 3600], ["minute", 60]] as const) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "minute");
}

/**
 * Opens where a notification leads: a path stored with it, the same in both
 * apps (issue #241) - the host says where one that isn't its own goes (a
 * set or a song, in Songverse, from Planiverse).
 */
export function useOpenNotification() {
  const { links } = usePlanning();
  const router = useRouter();
  return (url: string) => {
    const href = links.notification(url);
    if (/^https?:\/\//.test(href)) window.location.href = href;
    else router.history.push(href);
  };
}

/**
 * The notifications, newest first (issue #236): each opens what it's about
 * and marks itself read; a request to connect is answered right there
 * (issue #149). For the bell and the Notifications page.
 */
export function NotificationList({ items, onRead, onOpened }: { items: AppNotification[]; onRead: (ids: string[]) => void; onOpened?: () => void }) {
  const { i18n } = useTranslation();
  const open = useOpenNotification();
  const messages = i18n.getResourceBundle(i18n.language, "translation") as Messages;
  return (
    <ul className="divide-y" data-testid="notification-items">
      {items.map((item) => {
        const text = notificationText(item.kind, item.data, messages, i18n.language);
        return (
          <li key={item.id} className={cn(!item.read && "bg-primary/5")} data-notification={item.kind} data-read={item.read}>
            <button
              type="button"
              className="flex w-full gap-2 px-3 py-2 text-left hover:bg-muted"
              onClick={() => {
                if (!item.read) onRead([item.id]);
                onOpened?.();
                if (item.url) open(item.url);
              }}
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-primary")} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{text.title}</span>
                {text.body ? <span className="block text-xs text-muted-foreground">{text.body}</span> : null}
                <span className="block text-xs text-muted-foreground">{ago(item.createdAt, i18n.language)}</span>
              </span>
            </button>
            {item.kind === "CONNECTION_REQUESTED" && item.data.connectionId ? <ConnectionAnswer connectionId={item.data.connectionId} onAnswered={() => !item.read && onRead([item.id])} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Accept or decline a request to connect, from its notification (issue #149). */
function ConnectionAnswer({ connectionId, onAnswered }: { connectionId: string; onAnswered: () => void }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "busy" | "accepted" | "declined" | "gone">("idle");
  const answer = async (accept: boolean) => {
    setState("busy");
    try {
      await (accept ? api.acceptConnection(connectionId) : api.declineConnection(connectionId));
      setState(accept ? "accepted" : "declined");
    } catch (error) {
      // Answered already (on People, or on another device): nothing left to do.
      if (error instanceof ApiError && error.status === 404) setState("gone");
      else {
        setState("idle");
        return;
      }
    }
    onAnswered();
  };
  if (state === "accepted" || state === "declined" || state === "gone") {
    return (
      <p className="px-7 pb-2 text-xs text-muted-foreground" data-testid="connection-answered">
        {state === "accepted" ? t("notifications.accepted") : state === "declined" ? t("notifications.declined") : t("notifications.alreadyAnswered")}
      </p>
    );
  }
  return (
    <div className="flex gap-2 px-7 pb-2">
      <Button size="sm" className="h-7" disabled={state === "busy"} onClick={() => void answer(true)} data-testid="connection-accept">
        <Check />
        {t("notifications.accept")}
      </Button>
      <Button size="sm" variant="outline" className="h-7" disabled={state === "busy"} onClick={() => void answer(false)} data-testid="connection-decline">
        <X />
        {t("notifications.decline")}
      </Button>
    </div>
  );
}
