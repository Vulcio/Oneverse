import { isPushEndpoint } from "@oneverse/core";
import webpush from "web-push";
import { PROVIDER_TIMEOUT_MS } from "../metadata/provider-timeout.js";
import { pushTestOrigins, type PushConfig } from "./notification-settings.js";

/** What a device shows: its words, and where tapping it leads (a path in the web app). */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** Pushes with the same tag replace each other on the device. */
  tag?: string;
}

/** Who sends, as push services want it: the saved or env contact, else the web app's address if https, else a mailto: at its host. */
export function pushSubject(config: PushConfig, webUrl: string): string {
  if (config.subject) return config.subject;
  const url = new URL(webUrl);
  return url.protocol === "https:" ? url.origin : `mailto:notifications@${url.hostname}`;
}

/**
 * One push to one device (issue #236), encrypted for it and signed with
 * the server's VAPID key by web-push, posted here: only to a push
 * service's address (checked again before each post), no redirects
 * followed, waiting PROVIDER_TIMEOUT_MS at most. "gone": the push service
 * says the device unsubscribed - forget it; "failed": why (issue #237), the
 * push service's status and what it said, or that it couldn't be reached.
 */
export async function sendPush(
  device: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
  config: PushConfig,
  subject: string,
): Promise<{ result: "sent" | "gone" } | { result: "failed"; error: string }> {
  if (!isPushEndpoint(device.endpoint, pushTestOrigins())) return { result: "gone" };
  const details = webpush.generateRequestDetails({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, JSON.stringify(payload), {
    vapidDetails: { subject, publicKey: config.publicKey, privateKey: config.privateKey },
    // A day: a phone that's off gets it when it's back, not a week later.
    TTL: 24 * 60 * 60,
    contentEncoding: "aes128gcm",
    ...(payload.tag ? { topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined } : {}),
  });
  const headers = Object.fromEntries(Object.entries(details.headers).filter(([name]) => name.toLowerCase() !== "content-length").map(([name, value]) => [name, String(value)]));
  try {
    const response = await fetch(details.endpoint, { method: details.method, headers, body: details.body ? new Uint8Array(details.body) : undefined, redirect: "manual", signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
    if (response.status === 404 || response.status === 410) return { result: "gone" };
    if (response.ok) return { result: "sent" };
    const said = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200);
    return { result: "failed", error: `${new URL(device.endpoint).hostname} answered ${response.status}${said ? `: ${said}` : ""}` };
  } catch (error) {
    const why = error instanceof Error && error.name === "TimeoutError" ? `no answer in ${PROVIDER_TIMEOUT_MS / 1000} s` : error instanceof Error ? error.message : String(error);
    return { result: "failed", error: `Couldn't reach ${new URL(device.endpoint).hostname}: ${why}` };
  }
}
