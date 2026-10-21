import { prisma } from "@oneverse/db";
import type { SaveNotificationServerSettingsRequest } from "@oneverse/core";
import { decryptSecret, encryptSecret } from "@oneverse/secret-crypto";
import webpush from "web-push";

const SINGLETON_ID = "singleton";
const EMAIL_ENV = "NOTIFICATION_EMAILS";

export type NotificationSettingSource = "database" | "env" | "default";

function bool(raw: string | undefined): boolean | undefined {
  return raw === "true" || raw === "1" ? true : raw === "false" || raw === "0" ? false : undefined;
}

function resolveEmail(stored: boolean | null | undefined): { value: boolean; source: NotificationSettingSource } {
  if (stored !== null && stored !== undefined) return { value: stored, source: "database" };
  const env = bool(process.env[EMAIL_ENV]);
  if (env !== undefined) return { value: env, source: "env" };
  // Off: Resend's free tier caps what's sent, and account mail must get through.
  return { value: false, source: "default" };
}

/**
 * How notifications go out (issue #236): Admin > Notifications' row, then
 * the env var, then the default. Resolved fresh on each use (CLAUDE.md):
 * the API and the Worker share no memory.
 */
export async function getEffectiveNotificationSettings(): Promise<{ emailEnabled: boolean }> {
  const stored = await prisma.notificationSettings.findUnique({ where: { id: SINGLETON_ID } });
  return { emailEnabled: resolveEmail(stored?.emailEnabled).value };
}

/** Web push's keys and who sends (issue #236). */
export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string | null;
}

type Row = Awaited<ReturnType<typeof prisma.notificationSettings.findUnique>>;

/** The key pair saved in Admin if both halves are there, else the env vars', else none. Never one half from each. */
function resolvePush(stored: Row): { config: PushConfig | null; source: "database" | "env" | "none"; error?: string } {
  const subject = stored?.vapidSubject || process.env.VAPID_SUBJECT || null;
  if (stored?.vapidPublicKey && stored.vapidPrivateKeyEncrypted) {
    try {
      return { config: { publicKey: stored.vapidPublicKey, privateKey: decryptSecret(stored.vapidPrivateKeyEncrypted, process.env.SETTINGS_ENCRYPTION_KEY), subject }, source: "database" };
    } catch {
      // Saved with another SETTINGS_ENCRYPTION_KEY: as good as none, and said (issue #237).
      return { config: null, source: "database", error: "The saved VAPID private key can't be decrypted here: this process's SETTINGS_ENCRYPTION_KEY isn't the one it was saved with" };
    }
  }
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (publicKey && privateKey) return { config: { publicKey, privateKey, subject }, source: "env" };
  return { config: null, source: "none" };
}

/** Web push as set up now, or null: not set up. Resolved fresh on each use. */
export async function getPushConfig(): Promise<PushConfig | null> {
  return resolvePush(await prisma.notificationSettings.findUnique({ where: { id: SINGLETON_ID } })).config;
}

/** Web push as set up now, or why it can't be used here though it's set up (a key that can't be decrypted); both null: not set up. */
export async function getPushConfigOrError(): Promise<{ config: PushConfig | null; error: string | null }> {
  const { config, error } = resolvePush(await prisma.notificationSettings.findUnique({ where: { id: SINGLETON_ID } }));
  return { config, error: error ?? null };
}

/** Push addresses allowed besides the push services', for tests only (a stand-in push service): PUSH_TEST_ORIGINS, comma-separated. */
export function pushTestOrigins(): string[] {
  return (process.env.PUSH_TEST_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** For Admin > Notifications: each setting's value and where it comes from; never the private key, only whether it's saved. */
export async function getNotificationSettingsSummary() {
  const stored = await prisma.notificationSettings.findUnique({ where: { id: SINGLETON_ID } });
  const emailEnabled = { ...resolveEmail(stored?.emailEnabled), env: EMAIL_ENV };
  const push = resolvePush(stored);
  const sources = [emailEnabled.source, push.source];
  return {
    source: sources.includes("database") ? "database" : sources.includes("env") ? "env" : "none",
    settings: { emailEnabled },
    push: {
      source: push.source,
      ready: push.config !== null,
      publicKey: push.config?.publicKey ?? stored?.vapidPublicKey ?? null,
      hasDatabasePrivateKey: !!stored?.vapidPrivateKeyEncrypted,
      error: push.error ?? null,
      subject: stored?.vapidSubject ?? null,
      subjectEnv: process.env.VAPID_SUBJECT ?? null,
    },
  } as const;
}

/** Saves what's given: left out keeps its value, null or "" clears it (back to the env var or default). The private key is kept encrypted. */
export async function saveNotificationSettings(input: SaveNotificationServerSettingsRequest): Promise<void> {
  const data: Record<string, unknown> = {};
  if (input.emailEnabled !== undefined) data.emailEnabled = input.emailEnabled;
  if (input.vapidPublicKey !== undefined) data.vapidPublicKey = input.vapidPublicKey;
  if (input.vapidPrivateKey !== undefined) data.vapidPrivateKeyEncrypted = input.vapidPrivateKey ? encryptSecret(input.vapidPrivateKey, process.env.SETTINGS_ENCRYPTION_KEY) : null;
  if (input.vapidSubject !== undefined) data.vapidSubject = input.vapidSubject;
  await prisma.notificationSettings.upsert({ where: { id: SINGLETON_ID }, create: { id: SINGLETON_ID, ...data }, update: data });
}

/** A new VAPID key pair, saved (devices subscribed with the old one must subscribe again). Returns the public key. */
export async function generatePushKeys(): Promise<{ publicKey: string }> {
  const keys = webpush.generateVAPIDKeys();
  await saveNotificationSettings({ vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey });
  return { publicKey: keys.publicKey };
}

/** Back to the environment variables. */
export async function clearNotificationSettings(): Promise<void> {
  await prisma.notificationSettings.deleteMany({ where: { id: SINGLETON_ID } });
}
