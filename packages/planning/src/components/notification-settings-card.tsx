import { notificationSectionsFor, type MyNotificationPreferences, type NotificationChannel, type NotificationKind, type NotificationSectionKey } from "@oneverse/core";
import { BellOff, BellRing, ChevronDown, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { cn } from "@oneverse/ui/lib/utils";
import { usePlanning } from "../host";
import { usePushDevice } from "../use-push-device";
import { formatSetDate } from "@oneverse/ui/lib/dates";
import { FieldError } from "@oneverse/ui/components/field";

const CHANNELS: NotificationChannel[] = ["push", "email"];

/** Loads one's notification choices, and changes them as they're shown: what's saved comes back. */
export function useNotificationPreferences() {
  const { api } = usePlanning();
  const [preferences, setPreferences] = useState<MyNotificationPreferences | null>(null);
  useEffect(() => {
    void api.getMyNotificationPreferences().then(setPreferences);
  }, [api]);

  const change = async (kinds: NotificationKind[], channel: NotificationChannel, on: boolean) => {
    if (!preferences || kinds.length === 0) return;
    // Shown at once; the answer is what was saved.
    const next = { ...preferences.kinds };
    for (const kind of kinds) next[kind] = { ...next[kind], [channel]: on };
    setPreferences({ ...preferences, kinds: next });
    setPreferences(await api.updateMyNotificationPreferences({ kinds: Object.fromEntries(kinds.map((kind) => [kind, { [channel]: on }])) }));
  };

  const saveQuiet = async (next: { from: string; to: string } | null) => {
    if (!preferences || (next && next.from === next.to)) return;
    const quietHours = next ? { ...next, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : null;
    setPreferences({ ...preferences, quiet: quietHours });
    setPreferences(await api.updateMyNotificationPreferences({ quiet: quietHours }));
  };

  const sections = preferences ? notificationSectionsFor({ runsTeams: preferences.runsTeams ?? true, serverAdmin: preferences.serverAdmin ?? true }) : [];
  return { preferences, sections, change, saveQuiet };
}

/** How many of `kinds` go by `channel`: all, none, or some. */
function stateOf(preferences: MyNotificationPreferences, kinds: readonly NotificationKind[], channel: NotificationChannel) {
  const on = kinds.filter((kind) => preferences.kinds[kind][channel]).length;
  return { on, total: kinds.length, all: on === kinds.length, none: on === 0 };
}

/** A section's or everything's switch for one channel: On, Off, or "3 of 8"; pressed, all on unless all already are. */
function ChannelSwitch({ preferences, kinds, channel, available, label, onChange, testId }: { preferences: MyNotificationPreferences; kinds: readonly NotificationKind[]; channel: NotificationChannel; available: boolean; label: string; onChange: (on: boolean) => void; testId: string }) {
  const { t } = useTranslation();
  const state = stateOf(preferences, kinds, channel);
  const text = state.all ? t("settings.notifications.on") : state.none ? t("settings.notifications.off") : t("settings.notifications.some", { count: state.on, total: state.total });
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={state.all ? true : state.none ? false : "mixed"}
      disabled={!available}
      onClick={() => onChange(!state.all)}
      data-testid={testId}
      data-state={state.all ? "on" : state.none ? "off" : "some"}
      className={cn(
        "h-7 w-16 justify-self-center rounded-full border text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
        state.all && "border-primary bg-primary text-primary-foreground",
        state.none && "bg-background text-muted-foreground",
        !state.all && !state.none && "border-primary/40 bg-primary/10 text-foreground",
      )}
    >
      {text}
    </button>
  );
}

/**
 * How notifications reach one besides the bell (issues #236, #540): the
 * kinds in sections, each turned on or off by push and by email at once,
 * or opened to choose kind by kind; then this device and quiet hours.
 * What the server doesn't send (Admin > Notifications), it says.
 */
export function NotificationSettingsCard() {
  const { api, devicePush = true } = usePlanning();
  const { t, i18n } = useTranslation();
  const { preferences, sections, change, saveQuiet } = useNotificationPreferences();
  const { devices, here, thisDevice, permission, busy, error, run, turnOn, remove } = usePushDevice(preferences === null ? undefined : preferences.pushKey);
  const [open, setOpen] = useState<Partial<Record<NotificationSectionKey, boolean>>>({});
  const [testSent, setTestSent] = useState(false);

  const pushAvailable = !!preferences?.pushKey;
  const emailAvailable = !!preferences?.emailAvailable;
  const available = (channel: NotificationChannel) => (channel === "push" ? pushAvailable : emailAvailable);
  const channelName = (channel: NotificationChannel) => (channel === "push" ? t("notifications.channelPush") : t("notifications.channelEmail"));
  const allKinds = sections.flatMap((section) => section.kinds);
  const quiet = preferences?.quiet ?? null;

  return (
    <div className="flex flex-col gap-6" id="notifications" data-testid="notification-settings" data-ready={preferences ? "true" : undefined}>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("notifications.settingsTitle")}</CardTitle>
          <CardDescription>{t("settings.notifications.intro")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {preferences && !emailAvailable ? (
            <p className="text-xs text-muted-foreground" data-testid="notification-email-off">
              {t("notifications.emailOff")}
            </p>
          ) : null}
          {preferences && !pushAvailable ? (
            <p className="text-xs text-muted-foreground" data-testid="notification-push-off">
              {t("notifications.pushOffServer")}
            </p>
          ) : null}
          {preferences ? (
            <div className="flex flex-col text-sm">
              <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-x-3 pb-2 sm:gap-x-5">
                <span />
                {CHANNELS.map((channel) => (
                  <span key={channel} className="text-center text-xs font-medium text-muted-foreground uppercase">
                    {channelName(channel)}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-x-3 border-t py-3 sm:gap-x-5">
                <div>
                  <p className="font-semibold">{t("settings.notifications.everything")}</p>
                  <p className="text-xs text-muted-foreground">{t("settings.notifications.everythingHint")}</p>
                </div>
                {CHANNELS.map((channel) => (
                  <ChannelSwitch
                    key={channel}
                    preferences={preferences}
                    kinds={allKinds}
                    channel={channel}
                    available={available(channel)}
                    label={`${t("settings.notifications.everything")} - ${channelName(channel)}`}
                    onChange={(on) => void change(allKinds, channel, on)}
                    testId={`notify-all-${channel}`}
                  />
                ))}
              </div>
              {sections.map((section) => {
                const title = t(`settings.notifications.sections.${section.key}.title`);
                const isOpen = !!open[section.key];
                return (
                  <div key={section.key} className="border-t py-3" data-testid={`notify-section-${section.key}`}>
                    <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-x-3 sm:gap-x-5">
                      <div className="flex min-w-0 flex-col items-start gap-0.5">
                        <p className="flex items-center gap-2 font-semibold">
                          {title}
                          {section.key === "running" ? <Badge>{t("settings.notifications.forAdmins")}</Badge> : null}
                        </p>
                        <p className="text-xs text-muted-foreground">{t(`settings.notifications.sections.${section.key}.hint`)}</p>
                        <button
                          type="button"
                          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          aria-expanded={isOpen}
                          onClick={() => setOpen({ ...open, [section.key]: !isOpen })}
                          data-testid={`notify-open-${section.key}`}
                        >
                          {isOpen ? t("settings.notifications.hideKinds") : t("settings.notifications.chooseOne", { count: section.kinds.length })}
                          <ChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} aria-hidden />
                        </button>
                      </div>
                      {CHANNELS.map((channel) => (
                        <ChannelSwitch
                          key={channel}
                          preferences={preferences}
                          kinds={section.kinds}
                          channel={channel}
                          available={available(channel)}
                          label={`${title} - ${channelName(channel)}`}
                          onChange={(on) => void change(section.kinds, channel, on)}
                          testId={`notify-${section.key}-${channel}`}
                        />
                      ))}
                    </div>
                    {isOpen ? (
                      <div className="mt-2 flex flex-col rounded-md bg-muted/50 px-3">
                        {section.kinds.map((kind) => (
                          <div key={kind} className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-x-3 border-b py-2 last:border-b-0 sm:gap-x-5">
                            <span>{t(`notifications.kindLabels.${kind}`)}</span>
                            {CHANNELS.map((channel) => (
                              <input
                                key={channel}
                                type="checkbox"
                                className="size-4 justify-self-center"
                                aria-label={`${t(`notifications.kindLabels.${kind}`)} - ${channelName(channel)}`}
                                checked={preferences.kinds[kind][channel]}
                                disabled={!available(channel)}
                                onChange={(event) => void change([kind], channel, event.target.checked)}
                                data-testid={`notify-${channel}-${kind}`}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {pushAvailable ? (
        <div className="grid grid-cols-1 items-start gap-6 @3xl:grid-cols-2">
          {/* Where the app can't get them on the device (Oneverse's home), its devices are turned on in Plan or Songverse. */}
          {devicePush ? (
          <Card data-testid="push-devices">
            <CardHeader>
              <CardTitle className="text-sm">{t("notifications.thisDevice")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
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
                      await api.testMyPushDevices();
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
              {error ? <FieldError>{error}</FieldError> : null}
            </CardContent>
          </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.notifications.quietTitle")}</CardTitle>
              <CardDescription>{t("notifications.quietHint")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="size-4" checked={!!quiet} onChange={(event) => void saveQuiet(event.target.checked ? { from: "22:00", to: "07:00" } : null)} data-testid="quiet-on" />
                {t("notifications.quietOn")}
              </label>
              {quiet ? (
                <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="quiet-hours">
                  <span>{t("notifications.quietFrom")}</span>
                  <Input type="time" className="w-28" aria-label={t("notifications.quietFrom")} defaultValue={quiet.from} onBlur={(event) => void saveQuiet({ from: event.target.value, to: quiet.to })} data-testid="quiet-from" />
                  <span>{t("notifications.quietTo")}</span>
                  <Input type="time" className="w-28" aria-label={t("notifications.quietTo")} defaultValue={quiet.to} onBlur={(event) => void saveQuiet({ from: quiet.from, to: event.target.value })} data-testid="quiet-to" />
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
