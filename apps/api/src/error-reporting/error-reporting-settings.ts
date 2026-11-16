import { prisma } from "@oneverse/db";
import { parseDsn, type ErrorReportingTarget, type SaveErrorReportingSettingsRequest } from "@oneverse/core";

const SINGLETON_ID = "singleton";
const ENV = { dsn: "ERROR_REPORTING_DSN", browsers: "ERROR_REPORTING_BROWSERS", environment: "ERROR_REPORTING_ENVIRONMENT" } as const;
const DEFAULT_ENVIRONMENT = "production";
/** Read again at most this often by a process that's reporting: errors can come in bursts, the database may be why. */
const FRESH_FOR_MS = 30_000;

export type ErrorReportingSource = "database" | "env" | "default";
interface Setting<T> {
  value: T;
  source: ErrorReportingSource;
  env: string;
}

/** What reporting does now: where reports go (null: nowhere, off), browsers' too, under which environment. */
export interface EffectiveErrorReporting {
  target: ErrorReportingTarget | null;
  browsers: boolean;
  environment: string;
}

type Row = { dsn: string | null; browsers: boolean | null; environment: string | null } | null;

const flag = (raw: string | undefined) => (raw === "true" || raw === "1" ? true : raw === "false" || raw === "0" ? false : null);

/** Admin > Error reporting's row, then the env vars (ERROR_REPORTING_*), then off. */
function resolve(row: Row, env: NodeJS.ProcessEnv = process.env) {
  const text = (stored: string | null | undefined, name: string, fallback: string | null): Setting<string | null> => {
    if (stored) return { value: stored, source: "database", env: name };
    const raw = env[name]?.trim();
    if (raw) return { value: raw, source: "env", env: name };
    return { value: fallback, source: "default", env: name };
  };
  const browsersEnv = flag(env[ENV.browsers]);
  const browsers: Setting<boolean> =
    row?.browsers !== null && row?.browsers !== undefined
      ? { value: row.browsers, source: "database", env: ENV.browsers }
      : browsersEnv !== null
        ? { value: browsersEnv, source: "env", env: ENV.browsers }
        : { value: false, source: "default", env: ENV.browsers };
  return { dsn: text(row?.dsn, ENV.dsn, null), browsers, environment: text(row?.environment, ENV.environment, DEFAULT_ENVIRONMENT) as Setting<string> };
}

export function effectiveErrorReporting(row: Row, env: NodeJS.ProcessEnv = process.env): EffectiveErrorReporting {
  const settings = resolve(row, env);
  const target = parseDsn(settings.dsn.value);
  return { target, browsers: !!target && settings.browsers.value, environment: settings.environment.value };
}

let cached: { at: number; value: EffectiveErrorReporting } | null = null;

/**
 * Reporting as it is now, read again every half minute at most: an admin's
 * save reaches every API instance and the Worker within that, without a restart.
 */
export async function errorReporting(): Promise<EffectiveErrorReporting> {
  if (cached && Date.now() - cached.at < FRESH_FOR_MS) return cached.value;
  const row = await prisma.errorReportingSettings.findUnique({ where: { id: SINGLETON_ID } });
  cached = { at: Date.now(), value: effectiveErrorReporting(row) };
  return cached.value;
}

/** For Admin > Error reporting: each setting, and where it comes from. The DSN is shown: it holds only the project's public key. */
export async function getErrorReportingSummary() {
  const row = await prisma.errorReportingSettings.findUnique({ where: { id: SINGLETON_ID } });
  const settings = resolve(row);
  const sources = [settings.dsn, settings.browsers, settings.environment].map((one) => one.source);
  const source = sources.includes("database") ? "database" : sources.includes("env") ? "env" : "none";
  return { source, on: !!parseDsn(settings.dsn.value), settings };
}

/** Left out keeps its value; null or "" clears it (back to the env var, then off). */
export async function saveErrorReportingSettings(input: SaveErrorReportingSettingsRequest): Promise<void> {
  const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, value === "" ? null : value]));
  await prisma.errorReportingSettings.upsert({ where: { id: SINGLETON_ID }, create: { id: SINGLETON_ID, ...data }, update: data });
  cached = null;
}

/** Back to the environment variables. */
export async function clearErrorReportingSettings(): Promise<void> {
  await prisma.errorReportingSettings.deleteMany({ where: { id: SINGLETON_ID } });
  cached = null;
}
