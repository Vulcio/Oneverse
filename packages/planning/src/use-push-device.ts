import type { PushDevice } from "@oneverse/core";
import { createDeviceStore } from "@oneverse/ui/lib/device-store";
import { useCallback, useEffect, useState } from "react";
import { usePlanning } from "./host";
import { currentSubscription, deviceLabel, pushSupported, subscribe } from "./push";

/**
 * Where this device stands for notifications (issue #568):
 * - `loading`: not known yet;
 * - `unavailable`: the server sends none to devices, or this app can't (no service worker);
 * - `unsupported`: this browser can't show them (or an iPhone outside its home-screen app);
 * - `denied`: blocked in the browser's settings, so only the person can allow them again;
 * - `on`: this browser's push address is one of the person's devices;
 * - `off`: it could be turned on here.
 */
export type PushHere = "loading" | "unavailable" | "unsupported" | "denied" | "on" | "off";

/** "Not now" on the bell's "turn on here" row: this device isn't asked there again (the settings still offer it). */
const pushPromptHidden = createDeviceStore<boolean>("oneverse.pushPromptHidden", {
  fallback: false,
  parse: (raw) => raw === "1",
  format: (hidden) => (hidden ? "1" : null),
});
export const hidePushPrompt = () => pushPromptHidden.set(true);
export const usePushPromptHidden = pushPromptHidden.use;

/**
 * This device's push, for the settings card, the bell and Getting started
 * (issue #568): the person's devices, which one is this browser (its
 * subscription's endpoint matched against theirs, issue #236), and turning
 * it on or off. `pushKey` is the server's (null when it sends none,
 * undefined until known); nothing is read until `enabled`.
 */
export function usePushDevice(pushKey: string | null | undefined, enabled = true) {
  const { api, devicePush = true } = usePlanning();
  const [devices, setDevices] = useState<PushDevice[]>([]);
  // This device's push address, if it's on; undefined until known.
  const [here, setHere] = useState<string | null | undefined>(undefined);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setDevices(await api.listMyPushDevices());
    const subscription = await currentSubscription().catch(() => null);
    setHere(subscription?.endpoint ?? null);
  }, [api]);

  useEffect(() => {
    if (!enabled) return;
    setPermission(pushSupported() ? Notification.permission : "unsupported");
    if (devicePush) void reload().catch(() => {});
  }, [enabled, devicePush, reload]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  /** The browser's own question, then this device added to the person's. */
  const turnOn = () =>
    run(async () => {
      if (!pushKey) return;
      const subscription = await subscribe(pushKey);
      setPermission(Notification.permission);
      if (!subscription) return;
      const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api.addMyPushDevice({ endpoint: json.endpoint, keys: json.keys, label: deviceLabel(navigator.userAgent) });
      await reload();
    });

  const remove = (device: PushDevice) =>
    run(async () => {
      await api.removeMyPushDevice(device.id);
      if (device.endpoint === here) await (await currentSubscription())?.unsubscribe();
      await reload();
    });

  const thisDevice = devices.find((device) => device.endpoint === here);
  const state: PushHere =
    pushKey === null || !devicePush
      ? "unavailable"
      : permission === "unsupported"
        ? "unsupported"
        : permission === "denied"
          ? "denied"
          : pushKey === undefined || here === undefined
            ? "loading"
            : thisDevice
              ? "on"
              : "off";

  return { state, devices, here, thisDevice, permission, busy, error, run, turnOn, remove };
}
