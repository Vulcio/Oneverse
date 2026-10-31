import { prisma } from "@oneverse/db";
import type { SaveSecuritySettingsRequest } from "@oneverse/core";
import { requestMemo } from "../common/request-memo.js";

const SINGLETON_ID = "singleton";

export type SecuritySettingSource = "database" | "env" | "default";

export interface EffectiveSecuritySettings {
  rateLimitEnabled: boolean;
  /** Requests a minute, per signed-in user. */
  rateLimitPerMinute: number;
  /** Requests a minute, per address, before signing in. */
  rateLimitAnonymousPerMinute: number;
  /** Requests a minute on the expensive routes (uploads, lookups, joins), per user or address. */
  rateLimitHeavyPerMinute: number;
  /** Proxies in front of the API whose X-Forwarded-For is trusted. */
  trustedProxies: number;
  /** /api/docs for everyone, else global admins only. */
  apiDocsPublic: boolean;
  /** The web app's Content-Security-Policy (issue #114): enforced, only reported, or off. */
  contentSecurityPolicy: "ENFORCE" | "REPORT_ONLY" | "OFF";
  /** Only invited people can create an account (issue #198). */
  signupInviteOnly: boolean;
}

type Key = keyof EffectiveSecuritySettings;

const production = () => process.env.NODE_ENV === "production";

/** Each setting's env var and default (issue #113). Out of production, no limits and public docs, as before. */
const FIELDS: { [K in Key]: { env: string; parse: (raw: string) => EffectiveSecuritySettings[K] | undefined; fallback: () => EffectiveSecuritySettings[K] } } = {
  rateLimitEnabled: { env: "RATE_LIMIT_ENABLED", parse: bool, fallback: production },
  rateLimitPerMinute: { env: "RATE_LIMIT_PER_MINUTE", parse: int, fallback: () => 600 },
  rateLimitAnonymousPerMinute: { env: "RATE_LIMIT_ANONYMOUS_PER_MINUTE", parse: int, fallback: () => 120 },
  rateLimitHeavyPerMinute: { env: "RATE_LIMIT_HEAVY_PER_MINUTE", parse: int, fallback: () => 30 },
  trustedProxies: { env: "TRUSTED_PROXIES", parse: int, fallback: () => (production() ? 1 : 0) },
  apiDocsPublic: { env: "API_DOCS_PUBLIC", parse: bool, fallback: () => !production() },
  contentSecurityPolicy: { env: "CONTENT_SECURITY_POLICY", parse: cspMode, fallback: () => "ENFORCE" },
  signupInviteOnly: { env: "SIGNUP_INVITE_ONLY", parse: bool, fallback: () => false },
};

function cspMode(raw: string): EffectiveSecuritySettings["contentSecurityPolicy"] | undefined {
  const value = raw.toUpperCase().replace("-", "_");
  return value === "ENFORCE" || value === "REPORT_ONLY" || value === "OFF" ? value : undefined;
}

function bool(raw: string): boolean | undefined {
  return raw === "true" || raw === "1" ? true : raw === "false" || raw === "0" ? false : undefined;
}
function int(raw: string): number | undefined {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function resolve<K extends Key>(key: K, stored: EffectiveSecuritySettings[K] | null | undefined): { value: EffectiveSecuritySettings[K]; source: SecuritySettingSource } {
  if (stored !== null && stored !== undefined) return { value: stored, source: "database" };
  const raw = process.env[FIELDS[key].env];
  const parsed = raw === undefined ? undefined : FIELDS[key].parse(raw);
  if (parsed !== undefined) return { value: parsed as EffectiveSecuritySettings[K], source: "env" };
  return { value: FIELDS[key].fallback() as EffectiveSecuritySettings[K], source: "default" };
}

async function row() {
  return prisma.securitySettings.findUnique({ where: { id: SINGLETON_ID } });
}

/**
 * The API's protection settings (issue #113): Admin > Security's database
 * row first, then the env var, then the default. Resolved fresh on each
 * use, like the other admin settings (CLAUDE.md): the API's instances
 * share no memory, and an admin's save must hold on all of them at once.
 */
export async function getEffectiveSecuritySettings(): Promise<EffectiveSecuritySettings> {
  // Once per reading request (issue #341), fresh for the next.
  const stored = await requestMemo("securitySettings", row);
  const out = {} as Record<Key, unknown>;
  for (const key of Object.keys(FIELDS) as Key[]) out[key] = resolve(key, (stored?.[key] ?? null) as EffectiveSecuritySettings[typeof key] | null).value;
  return out as unknown as EffectiveSecuritySettings;
}

/** For Admin > Security: each setting's value and where it comes from. */
export async function getSecuritySettingsSummary() {
  const stored = await row();
  const settings = {} as Record<Key, { value: unknown; source: SecuritySettingSource; env: string }>;
  for (const key of Object.keys(FIELDS) as Key[]) settings[key] = { ...resolve(key, (stored?.[key] ?? null) as EffectiveSecuritySettings[typeof key] | null), env: FIELDS[key].env };
  const sources = Object.values(settings).map((setting) => setting.source);
  return {
    source: stored && sources.includes("database") ? "database" : sources.includes("env") ? "env" : "none",
    settings: settings as { [K in Key]: { value: EffectiveSecuritySettings[K]; source: SecuritySettingSource; env: string } },
  };
}

/** Saves what's given: left out keeps its value, null clears it (back to the env var or default). */
export async function saveSecuritySettings(input: SaveSecuritySettingsRequest): Promise<void> {
  const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  await prisma.securitySettings.upsert({ where: { id: SINGLETON_ID }, create: { id: SINGLETON_ID, ...data }, update: data });
}

/** Back to the environment variables. */
export async function clearSecuritySettings(): Promise<void> {
  await prisma.securitySettings.deleteMany({ where: { id: SINGLETON_ID } });
}

/**
 * Whether a request may read the API's docs (/api/docs, issue #113): anyone
 * when they're public (out of production, by default), else a global
 * admin, by the session cookie their browser sends the API.
 */
export async function apiDocsAllowed(headers: import("node:http").IncomingHttpHeaders): Promise<boolean> {
  if ((await getEffectiveSecuritySettings()).apiDocsPublic) return true;
  const [{ getAuth }, { fromNodeHeaders }] = await Promise.all([import("../auth/better-auth.js"), import("better-auth/node")]);
  const session = await (await getAuth()).api.getSession({ headers: fromNodeHeaders(headers) }).catch(() => null);
  return !!(session?.user as { isGlobalAdmin?: boolean } | undefined)?.isGlobalAdmin;
}
