import { prisma } from "@oneverse/db";
import type { SaveStemSeparationSettingsRequest } from "@oneverse/core";
import { decryptSecret, encryptSecret } from "@oneverse/secret-crypto";
import { randomBytes } from "node:crypto";

const SINGLETON_ID = "singleton";

export type StemSeparationSource = "database" | "env" | "none";

export interface EffectiveStemSeparationSettings {
  /** The Demucs API's address, without a trailing slash; null: not set up. */
  apiUrl: string | null;
  apiKey: string | null;
  /** What its webhooks are signed with; null without one saved (then only polling). */
  callbackSecret: string | null;
  fastModel: string;
  hqModel: string;
  hqEnabled: boolean;
  /** Separations a user may start in 30 days; null: no limit. */
  monthlyLimit: number | null;
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

function envInt(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : null;
}
function envBool(name: string): boolean | null {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "true" || raw === "1" ? true : raw === "false" || raw === "0" ? false : null;
}

/**
 * Stem separation's settings (issue #63): Admin > Stem separation's
 * database row first, then the env vars (DEMUCS_API_URL, DEMUCS_API_KEY,
 * DEMUCS_FAST_MODEL, DEMUCS_HQ_MODEL, DEMUCS_HQ_ENABLED,
 * STEM_SEPARATION_MONTHLY_LIMIT), then the defaults. Resolved fresh on
 * every use: the API and the Worker share no memory.
 */
export async function getEffectiveStemSeparationSettings(): Promise<EffectiveStemSeparationSettings> {
  const row = await prisma.stemSeparationSettings.findUnique({ where: { id: SINGLETON_ID } });
  const passphrase = process.env.SETTINGS_ENCRYPTION_KEY;
  const url = row?.apiUrl ?? process.env.DEMUCS_API_URL ?? null;
  return {
    apiUrl: url ? trimSlash(url) : null,
    apiKey: row?.apiKeyEnc ? decryptSecret(row.apiKeyEnc, passphrase) : (process.env.DEMUCS_API_KEY ?? null),
    callbackSecret: row?.callbackSecretEnc ? decryptSecret(row.callbackSecretEnc, passphrase) : (process.env.DEMUCS_CALLBACK_SECRET ?? null),
    fastModel: row?.fastModel ?? process.env.DEMUCS_FAST_MODEL ?? "htdemucs",
    hqModel: row?.hqModel ?? process.env.DEMUCS_HQ_MODEL ?? "htdemucs_ft",
    hqEnabled: row?.hqEnabled ?? envBool("DEMUCS_HQ_ENABLED") ?? true,
    monthlyLimit: row ? row.monthlyLimit : envInt("STEM_SEPARATION_MONTHLY_LIMIT"),
  };
}

/** For Admin: never the key, only whether the database holds one. */
export async function getStemSeparationSummary() {
  const row = await prisma.stemSeparationSettings.findUnique({ where: { id: SINGLETON_ID } });
  const settings = await getEffectiveStemSeparationSettings();
  const hasDatabaseKey = Boolean(row?.apiKeyEnc);
  return {
    source: (row?.apiUrl || hasDatabaseKey ? "database" : process.env.DEMUCS_API_URL ? "env" : "none") as StemSeparationSource,
    /** The instance's own server is optional (issue #300): teams and organisations may run theirs. */
    configured: Boolean(settings.apiUrl && settings.apiKey),
    apiUrl: settings.apiUrl,
    hasDatabaseKey,
    hasKey: Boolean(settings.apiKey),
    fastModel: settings.fastModel,
    hqModel: settings.hqModel,
    hqEnabled: settings.hqEnabled,
    monthlyLimit: settings.monthlyLimit,
    /** Whether its webhooks can be checked (else the Worker only polls). */
    signedCallbacks: Boolean(settings.callbackSecret),
    /** Teams and organisations may connect their own Sonic servers (issue #300), and on private or local addresses. */
    ownServers: row?.ownServers ?? envBool("STEM_SEPARATION_OWN_SERVERS") ?? false,
    ownServersPrivate: row?.ownServersPrivate ?? envBool("STEM_SEPARATION_OWN_SERVERS_PRIVATE") ?? false,
  };
}

/** Saves what's given: left out (or an empty key) keeps its value, null clears it. */
export async function saveStemSeparationSettings(input: SaveStemSeparationSettingsRequest): Promise<void> {
  const passphrase = process.env.SETTINGS_ENCRYPTION_KEY;
  const data: Record<string, unknown> = {};
  if (input.apiUrl !== undefined) data.apiUrl = input.apiUrl ? trimSlash(input.apiUrl) : null;
  if (input.apiKey) data.apiKeyEnc = encryptSecret(input.apiKey, passphrase);
  for (const key of ["fastModel", "hqModel", "hqEnabled", "monthlyLimit", "ownServers", "ownServersPrivate"] as const) if (input[key] !== undefined) data[key] = input[key];
  await prisma.stemSeparationSettings.upsert({ where: { id: SINGLETON_ID }, create: { id: SINGLETON_ID, ...data }, update: data });
  // Its webhooks signed from the first separation on, once the instance has a server.
  if ((await getEffectiveStemSeparationSettings()).apiUrl) await callbackSecret();
}

/** Back to the environment variables. */
export async function clearStemSeparationSettings(): Promise<void> {
  await prisma.stemSeparationSettings.deleteMany({ where: { id: SINGLETON_ID } });
}

/**
 * The secret the Demucs API signs its webhooks with: made the first time
 * one's needed and kept encrypted; null when there's no encryption key to
 * keep it with (the Worker then only polls).
 */
export async function callbackSecret(): Promise<string | null> {
  const current = await getEffectiveStemSeparationSettings();
  if (current.callbackSecret) return current.callbackSecret;
  const passphrase = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!passphrase) return null;
  const secret = randomBytes(32).toString("base64url");
  await prisma.stemSeparationSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, callbackSecretEnc: encryptSecret(secret, passphrase) },
    update: {},
  });
  // Another process may have made one first: theirs is the one kept.
  const row = await prisma.stemSeparationSettings.findUnique({ where: { id: SINGLETON_ID } });
  if (!row?.callbackSecretEnc) {
    await prisma.stemSeparationSettings.update({ where: { id: SINGLETON_ID }, data: { callbackSecretEnc: encryptSecret(secret, passphrase) } });
    return secret;
  }
  return decryptSecret(row.callbackSecretEnc, passphrase);
}
