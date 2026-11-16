import { prisma } from "@oneverse/db";
import { decryptSecret, encryptSecret } from "@oneverse/secret-crypto";

const SINGLETON_ID = "singleton";
const DEFAULT_EMAIL_FROM = "Songverse <onboarding@resend.dev>";

export type AuthConfigSource = "database" | "env" | "none";

/** How email goes out (issue #38). */
export type EmailProvider = "resend" | "smtp";

/** An SMTP server to send through: any mail host, a provider's relay (SES, Postmark, Mailgun, Gmail…). */
export interface SmtpSettings {
  host: string;
  port: number;
  /** TLS from the start (port 465); otherwise STARTTLS when the server offers it. */
  secure: boolean;
  user: string | undefined;
  password: string | undefined;
}

export interface EffectiveAuthSettings {
  resendApiKey: string | undefined;
  emailFrom: string;
  emailProvider: EmailProvider;
  /** The SMTP server, when one is set (its host). */
  smtp: SmtpSettings | undefined;
  googleClientId: string | undefined;
  googleClientSecret: string | undefined;
  /** Cache-invalidation key for better-auth.ts's getAuth() - null when no row exists. */
  updatedAt: Date | null;
}

/**
 * Resolves live email (Resend or SMTP, issue #38) and Google config: admin-managed database settings
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
  const resendApiKey = row?.resendApiKeyEnc ? decryptSecret(row.resendApiKeyEnc, passphrase) : process.env.RESEND_API_KEY;
  const smtp = smtpSettings(row);
  const password = row?.smtpPasswordEnc ? decryptSecret(row.smtpPasswordEnc, passphrase) : process.env.SMTP_PASSWORD || undefined;

  return {
    resendApiKey,
    emailFrom: row?.emailFrom ?? process.env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM,
    emailProvider: emailProvider(row, Boolean(resendApiKey), Boolean(smtp)),
    smtp: smtp && { ...smtp, password },
    googleClientId: row?.googleClientId ?? process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: row?.googleClientSecretEnc
      ? decryptSecret(row.googleClientSecretEnc, passphrase)
      : process.env.GOOGLE_CLIENT_SECRET,
    updatedAt: row?.updatedAt ?? null,
  };
}

type Row = Awaited<ReturnType<typeof prisma.authSettings.findUnique>>;

function envFlag(value: string | undefined): boolean | null {
  const flag = value?.trim().toLowerCase();
  return flag === "true" || flag === "1" ? true : flag === "false" || flag === "0" ? false : null;
}

/** The SMTP server's settings but its password: each field from the database, then its env var. Undefined without a host. */
function smtpSettings(row: Row): Omit<SmtpSettings, "password"> | undefined {
  const host = row?.smtpHost ?? (process.env.SMTP_HOST?.trim() || undefined);
  if (!host) return undefined;
  const envPort = Number(process.env.SMTP_PORT);
  const port = row?.smtpPort ?? (Number.isInteger(envPort) && envPort > 0 && envPort < 65536 ? envPort : null);
  const secure = row?.smtpSecure ?? envFlag(process.env.SMTP_SECURE) ?? port === 465;
  return { host, port: port ?? (secure ? 465 : 587), secure, user: row?.smtpUser ?? (process.env.SMTP_USER?.trim() || undefined) };
}

/** The provider picked (database, then EMAIL_PROVIDER), else whichever has credentials, Resend first. */
function emailProvider(row: Row, hasResend: boolean, hasSmtp: boolean): EmailProvider {
  const picked = row?.emailProvider ?? process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (picked === "resend" || picked === "smtp") return picked;
  return !hasResend && hasSmtp ? "smtp" : "resend";
}

export interface AuthConfigSummary {
  /** Where the email settings come from: any saved here, else any env var, else none (mail is only logged). */
  emailSource: AuthConfigSource;
  emailFrom: string;
  emailProvider: EmailProvider;
  /** Whether mail actually goes out: the provider has what it needs. */
  emailConfigured: boolean;
  hasDatabaseResendKey: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUser: string | null;
  hasDatabaseSmtpPassword: boolean;
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
  const hasResend = hasDatabaseResendKey || Boolean(process.env.RESEND_API_KEY);
  const smtp = smtpSettings(row);
  const provider = emailProvider(row, hasResend, Boolean(smtp));
  const savedEmail = hasDatabaseResendKey || Boolean(row?.smtpHost || row?.emailProvider);
  const envEmail = Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST?.trim() || process.env.EMAIL_PROVIDER?.trim());

  return {
    emailSource: savedEmail ? "database" : envEmail ? "env" : "none",
    emailFrom: row?.emailFrom ?? process.env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM,
    emailProvider: provider,
    emailConfigured: provider === "smtp" ? Boolean(smtp) : hasResend,
    hasDatabaseResendKey,
    smtpHost: smtp?.host ?? null,
    smtpPort: smtp?.port ?? null,
    smtpSecure: smtp?.secure ?? null,
    smtpUser: smtp?.user ?? null,
    hasDatabaseSmtpPassword: Boolean(row?.smtpPasswordEnc),
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
  /** "" clears it (back to EMAIL_PROVIDER, then whichever has credentials). */
  emailProvider?: EmailProvider | "";
  smtpHost?: string;
  /** null clears it. */
  smtpPort?: number | null;
  /** null clears it. */
  smtpSecure?: boolean | null;
  smtpUser?: string;
  smtpPassword?: string;
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
  const smtpPasswordEnc =
    input.smtpPassword !== undefined ? (input.smtpPassword ? encryptSecret(input.smtpPassword, passphrase) : null) : undefined;

  await prisma.authSettings.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      resendApiKeyEnc: resendApiKeyEnc ?? null,
      emailFrom: input.emailFrom || null,
      googleClientId: input.googleClientId || null,
      googleClientSecretEnc: googleClientSecretEnc ?? null,
      emailProvider: input.emailProvider || null,
      smtpHost: input.smtpHost || null,
      smtpPort: input.smtpPort ?? null,
      smtpSecure: input.smtpSecure ?? null,
      smtpUser: input.smtpUser || null,
      smtpPasswordEnc: smtpPasswordEnc ?? null,
    },
    update: {
      ...(resendApiKeyEnc !== undefined && { resendApiKeyEnc }),
      ...(input.emailFrom !== undefined && { emailFrom: input.emailFrom || null }),
      ...(input.googleClientId !== undefined && { googleClientId: input.googleClientId || null }),
      ...(googleClientSecretEnc !== undefined && { googleClientSecretEnc }),
      ...(input.emailProvider !== undefined && { emailProvider: input.emailProvider || null }),
      ...(input.smtpHost !== undefined && { smtpHost: input.smtpHost || null }),
      ...(input.smtpPort !== undefined && { smtpPort: input.smtpPort }),
      ...(input.smtpSecure !== undefined && { smtpSecure: input.smtpSecure }),
      ...(input.smtpUser !== undefined && { smtpUser: input.smtpUser || null }),
      ...(smtpPasswordEnc !== undefined && { smtpPasswordEnc }),
    },
  });
}

const EMAIL_CLEARED = {
  resendApiKeyEnc: null,
  emailFrom: null,
  emailProvider: null,
  smtpHost: null,
  smtpPort: null,
  smtpSecure: null,
  smtpUser: null,
  smtpPasswordEnc: null,
} as const;

export async function clearEmailAuthConfig(): Promise<void> {
  await prisma.authSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID },
    update: { ...EMAIL_CLEARED },
  });
}

export async function clearGoogleAuthConfig(): Promise<void> {
  await prisma.authSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, googleClientId: null, googleClientSecretEnc: null },
    update: { googleClientId: null, googleClientSecretEnc: null },
  });
}

