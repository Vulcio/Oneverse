import { prisma } from "@oneverse/db";
import { decryptSecret, encryptSecret } from "@oneverse/secret-crypto";

const SINGLETON_ID = "singleton";
const DEFAULT_EMAIL_FROM = "Songverse <onboarding@resend.dev>";

export type AuthConfigSource = "database" | "env" | "none";

export interface EffectiveAuthSettings {
  resendApiKey: string | undefined;
  emailFrom: string;
  googleClientId: string | undefined;
  googleClientSecret: string | undefined;
  /** Cache-invalidation key for better-auth.ts's getAuth() - null when no row exists. */
  updatedAt: Date | null;
}

/**
 * Resolves live Resend/Google config: admin-managed database settings
 * (AuthSettings, edited via Admin > Auth) first, then the matching env
 * var. Called fresh on every use rather than cached in memory - the same
 * cross-process-staleness reason as StorageService
 * (apps/api/src/storage/storage.service.ts): the API can run as several
 * replicas that share no memory, so an admin's save through one process
 * needs to be visible to requests served by another without a restart.
 * It's one cheap indexed lookup per call.
 */
export async function getEffectiveAuthSettings(): Promise<EffectiveAuthSettings> {
  const row = await prisma.authSettings.findUnique({ where: { id: SINGLETON_ID } });
  const passphrase = process.env.SETTINGS_ENCRYPTION_KEY;

  return {
    resendApiKey: row?.resendApiKeyEnc ? decryptSecret(row.resendApiKeyEnc, passphrase) : process.env.RESEND_API_KEY,
    emailFrom: row?.emailFrom ?? process.env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM,
    googleClientId: row?.googleClientId ?? process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: row?.googleClientSecretEnc
      ? decryptSecret(row.googleClientSecretEnc, passphrase)
      : process.env.GOOGLE_CLIENT_SECRET,
    updatedAt: row?.updatedAt ?? null,
  };
}

export interface AuthConfigSummary {
  emailSource: AuthConfigSource;
  emailFrom: string;
  hasDatabaseResendKey: boolean;
  googleSource: AuthConfigSource;
  googleClientId: string | null;
  hasDatabaseGoogleSecret: boolean;
}

/**
 * Admin-only summary for the Admin > Auth panel. Never returns a decrypted
 * or masked secret (matching StorageService.getConfigSummary()'s
 * discipline for the R2 secret key) - only whether the database holds
 * one, so the UI can show "leave blank to keep the current one" without
 * ever needing SETTINGS_ENCRYPTION_KEY just to render the page.
 */
export async function getAuthConfigSummary(): Promise<AuthConfigSummary> {
  const row = await prisma.authSettings.findUnique({ where: { id: SINGLETON_ID } });

  const hasDatabaseResendKey = Boolean(row?.resendApiKeyEnc);
  const hasDatabaseGoogleSecret = Boolean(row?.googleClientId && row.googleClientSecretEnc);

  return {
    emailSource: hasDatabaseResendKey ? "database" : process.env.RESEND_API_KEY ? "env" : "none",
    emailFrom: row?.emailFrom ?? process.env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM,
    hasDatabaseResendKey,
    googleSource: hasDatabaseGoogleSecret
      ? "database"
      : process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? "env"
        : "none",
    googleClientId: row?.googleClientId ?? null,
    hasDatabaseGoogleSecret,
  };
}

export interface SaveAuthConfigInput {
  resendApiKey?: string;
  emailFrom?: string;
  googleClientId?: string;
  googleClientSecret?: string;
}

/**
 * Partial update, like PATCH: a field left `undefined` keeps its current
 * value (so the admin never has to re-enter a secret just to change
 * emailFrom, say); an empty string clears it. Mirrors
 * StorageService.saveConfig()'s exact semantics. Throws
 * MissingEncryptionKeyError (caught by AdminService) if a secret is being
 * saved without SETTINGS_ENCRYPTION_KEY set.
 */
export async function saveAuthConfig(input: SaveAuthConfigInput): Promise<void> {
  const passphrase = process.env.SETTINGS_ENCRYPTION_KEY;

  const resendApiKeyEnc =
    input.resendApiKey !== undefined ? (input.resendApiKey ? encryptSecret(input.resendApiKey, passphrase) : null) : undefined;
  const googleClientSecretEnc =
    input.googleClientSecret !== undefined
      ? input.googleClientSecret
        ? encryptSecret(input.googleClientSecret, passphrase)
        : null
      : undefined;

  await prisma.authSettings.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      resendApiKeyEnc: resendApiKeyEnc ?? null,
      emailFrom: input.emailFrom || null,
      googleClientId: input.googleClientId || null,
      googleClientSecretEnc: googleClientSecretEnc ?? null,
    },
    update: {
      ...(resendApiKeyEnc !== undefined && { resendApiKeyEnc }),
      ...(input.emailFrom !== undefined && { emailFrom: input.emailFrom || null }),
      ...(input.googleClientId !== undefined && { googleClientId: input.googleClientId || null }),
      ...(googleClientSecretEnc !== undefined && { googleClientSecretEnc }),
    },
  });
}

export async function clearEmailAuthConfig(): Promise<void> {
  await prisma.authSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, resendApiKeyEnc: null, emailFrom: null },
    update: { resendApiKeyEnc: null, emailFrom: null },
  });
}

export async function clearGoogleAuthConfig(): Promise<void> {
  await prisma.authSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, googleClientId: null, googleClientSecretEnc: null },
    update: { googleClientId: null, googleClientSecretEnc: null },
  });
}

