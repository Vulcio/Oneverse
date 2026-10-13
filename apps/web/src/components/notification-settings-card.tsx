import { NOTIFICATION_KINDS, type MyNotificationPreferences, type NotificationChannel, type NotificationKind, type PushDevice } from "@songverse/core";
import { BellOff, BellRing, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { apiClient } from "#/lib/api-client";
import { currentSubscription, deviceLabel, pushSupported, subscribe } from "#/lib/push";
import { formatSetDate } from "#/lib/setlists";

/**
 * How notifications reach one besides the bell (issue #236): each kind by
 * email and to one's devices, saved as it's changed; this device turned on
 * or off; the devices turned on, a test, and quiet hours. What the server
 * doesn't send (Admin > Notifications), it says.
 */
export function NotificationSettingsCard() {
  const { t, i18n } = useTranslation();
  const [preferences, setPreferences] = useState<MyNotificationPreferences | null>(null);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  // This device's push address, if it's on; undefined until known.
  const [here, setHere] = useState<string | null | undefined>(undefined);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [busy, setBusy] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    setDevices(await apiClient.listMyPushDevices());
    const subscription = await currentSubscription().catch(() => null);
    setHere(subscription?.endpoint ?? null);
  }, []);

  useEffect(() => {
    void apiClient.getMyNotificationPreferences().then(setPreferences);
    setPermission(pushSupported() ? Notification.permission : "unsupported");
    void loadDevices();
  }, [loadDevices]);

  const change = async (kind: NotificationKind, channel: NotificationChannel, on: boolean) => {
    if (!preferences) return;
    // Shown at once; the answer is what was saved.
    setPreferences({ ...preferences, kinds: { ...preferences.kinds, [kind]: { ...preferences.kinds[kind], [channel]: on } } });
    setPreferences(await apiClient.updateMyNotificationPreferences({ kinds: { [kind]: { [channel]: on } } }));
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const turnOn = () =>
    run(async () => {
      if (!preferences?.pushKey) return;
      const subscription = await subscribe(preferences.pushKey);
      setPermission(Notification.permission);
      if (!subscription) return;
      const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await apiClient.addMyPushDevice({ endpoint: json.endpoint, keys: json.keys, label: deviceLabel(navigator.userAgent) });
      await loadDevices();
    });

  const remove = (device: PushDevice) =>
    run(async () => {
      await apiClient.removeMyPushDevice(device.id);
      if (device.endpoint === here) await (await currentSubscription())?.unsubscribe();
      await loadDevices();
    });

  const quiet = preferences?.quiet ?? null;
  const saveQuiet = async (next: { from: string; to: string } | null) => {
    if (!preferences || (next && next.from === next.to)) return;
    const quietHours = next ? { ...next, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : null;
    // Shown at once; the answer is what was saved.
    setPreferences({ ...preferences, quiet: quietHours });
    setPreferences(await apiClient.updateMyNotificationPreferences({ quiet: quietHours }));
  };

  const pushAvailable = !!preferences?.pushKey;
  const thisDevice = devices.find((device) => device.endpoint === here);

  return (
    <Card id="notifications" data-testid="notification-settings" data-ready={preferences ? "true" : undefined}>
      <CardHeader>
        <CardTitle className="text-sm">{t("notifications.settingsTitle")}</CardTitle>
        <CardDescription>{t("notifications.settingsDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          {preferences && !preferences.emailAvailable ? (
            <p className="text-xs text-muted-foreground" data-testid="notification-email-off">
              {t("notifications.emailOff")}
            </p>
          ) : null}
          {preferences && !pushAvailable ? (
            <p className="text-xs text-muted-foreground" data-testid="notification-push-off">
              {t("notifications.pushOffServer")}
            </p>
          ) : null}
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2 text-sm">
            <span />
            <span className="text-xs font-medium text-muted-foreground">{t("notifications.channelEmail")}</span>
            <span className="text-xs font-medium text-muted-foreground">{t("notifications.channelPush")}</span>
            {NOTIFICATION_KINDS.map((kind) => (
              <div key={kind} className="contents">
                <span>{t(`notifications.kindLabels.${kind}`)}</span>
                <input
                  type="checkbox"
                  className="size-4 justify-self-center"
                  aria-label={`${t(`notifications.kindLabels.${kind}`)} - ${t("notifications.channelEmail")}`}
                  checked={preferences?.kinds[kind].email ?? false}
                  disabled={!preferences?.emailAvailable}
                  onChange={(event) => void change(kind, "email", event.target.checked)}
                  data-testid={`notify-email-${kind}`}
                />
                <input
                  type="checkbox"
                  className="size-4 justify-self-center"
                  aria-label={`${t(`notifications.kindLabels.${kind}`)} - ${t("notifications.channelPush")}`}
                  checked={preferences?.kinds[kind].push ?? false}
                  disabled={!pushAvailable}
                  onChange={(event) => void change(kind, "push", event.target.checked)}
                  data-testid={`notify-push-${kind}`}
                />
              </div>
            ))}
          </div>
        </div>

        {pushAvailable ? (
          <div className="flex flex-col gap-2" data-testid="push-devices">
            <span className="text-sm font-medium">{t("notifications.thisDevice")}</span>
            {permission === "unsupported" ? (
              <p className="text-xs text-muted-foreground">{t("notifications.pushUnsupported")}</p>
            ) : permission === "denied" ? (
              <p className="text-xs text-muted-foreground">{t("notifications.pushDenied")}</p>
            ) : thisDevice ? (
              <Button variant="outline" size="sm" className="self-start" disabled={busy} onClick={() => void remove(thisDevice)} data-testid="push-off">
                <BellOff />
                {t("notifications.pushOff")}
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="self-start" disabled={busy || here === undefined} onClick={() => void turnOn()} data-testid="push-on">
                <BellRing />
                {t("notifications.pushOn")}
              </Button>
            )}

            <span className="mt-2 text-sm font-medium">{t("notifications.devices")}</span>
            {devices.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("notifications.noDevices")}</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {devices.map((device) => (
                  <li key={device.id} className="flex items-center justify-between gap-2 py-1.5" data-device={device.id}>
                    <span className="min-w-0 text-sm">
                      <span className="block truncate">
                        {device.label ?? "—"}
                        {device.endpoint === here ? <span className="text-muted-foreground"> · {t("notifications.thisDevice")}</span> : null}
                      </span>
                      <span className="block text-xs text-muted-foreground">{t("notifications.deviceAdded", { date: formatSetDate(device.createdAt.slice(0, 10), i18n.language) })}</span>
                      {device.lastError ? (
                        <span className="block text-xs break-words text-destructive" data-testid="push-device-error">
                          {t("notifications.deviceFailed", { date: formatSetDate((device.lastErrorAt ?? device.createdAt).slice(0, 10), i18n.language), error: device.lastError })}
                        </span>
                      ) : null}
                    </span>
                    <Button variant="ghost" size="icon" className="size-8" aria-label={t("notifications.removeDevice")} title={t("notifications.removeDevice")} disabled={busy} onClick={() => void remove(device)} data-testid="push-remove">
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {devices.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await apiClient.testMyPushDevices();
                    setTestSent(true);
                  })
                }
                data-testid="push-test"
              >
                <Send />
                {t("notifications.test")}
              </Button>
            ) : null}
            {testSent ? <p className="text-xs text-muted-foreground">{t("notifications.testSent")}</p> : null}

            <label className="mt-2 flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="size-4" checked={!!quiet} onChange={(event) => void saveQuiet(event.target.checked ? { from: "22:00", to: "07:00" } : null)} data-testid="quiet-on" />
              {t("notifications.quietOn")}
            </label>
            {quiet ? (
              <div className="flex items-center gap-2 text-sm" data-testid="quiet-hours">
                <span>{t("notifications.quietFrom")}</span>
                <Input type="time" className="w-28" aria-label={t("notifications.quietFrom")} defaultValue={quiet.from} onBlur={(event) => void saveQuiet({ from: event.target.value, to: quiet.to })} data-testid="quiet-from" />
                <span>{t("notifications.quietTo")}</span>
                <Input type="time" className="w-28" aria-label={t("notifications.quietTo")} defaultValue={quiet.to} onBlur={(event) => void saveQuiet({ from: quiet.from, to: event.target.value })} data-testid="quiet-to" />
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">{t("notifications.quietHint")}</p>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
