import { Logger } from "@nestjs/common";
import { errorEnvelope, errorEnvelopeHeaders, errorEvent, reportedError, type ErrorEventContext, type ErrorReportSource, type ReportedError } from "@oneverse/core";
import { providerFetch } from "../metadata/provider-timeout.js";
import { serverVersion } from "../common/version.js";
import { errorReporting } from "./error-reporting-settings.js";

const logger = new Logger("ErrorReporting");

/** The most reports one process sends a minute: a storm of the same failure mustn't flood the server or the network. */
const PER_MINUTE = 30;
/** The same error from the same place is sent once in this long. */
const SAME_ERROR_MS = 60_000;

let windowStart = 0;
let sentInWindow = 0;
const recent = new Map<string, number>();

/** Whether this one may go now: under the minute's cap, and not the same as one just sent. */
function mayReport(key: string, now = Date.now()): boolean {
  if (now - windowStart >= 60_000) {
    windowStart = now;
    sentInWindow = 0;
    for (const [one, at] of recent) if (now - at >= SAME_ERROR_MS) recent.delete(one);
  }
  if (sentInWindow >= PER_MINUTE) return false;
  const last = recent.get(key);
  if (last !== undefined && now - last < SAME_ERROR_MS) return false;
  sentInWindow += 1;
  recent.set(key, now);
  return true;
}

export interface ReportOptions {
  source: ErrorReportSource;
  where?: string | null;
  tags?: Record<string, string>;
  /** The release the error happened in, when it isn't this server's (a browser's page). */
  release?: string;
}

/**
 * Reports an error (issue #469) where Admin > Error reporting says, if it
 * says anywhere: scrubbed, at most PER_MINUTE a minute, the same one once a
 * minute. Never throws, and never waits on the caller: a report that can't
 * be sent is only logged. `browser`: a web app's, sent only when browsers'
 * errors are on. Resolves once sent (or dropped), for a test.
 */
export async function reportError(thrown: unknown | ReportedError, options: ReportOptions, { browser = false } = {}): Promise<boolean> {
  try {
    const settings = await errorReporting();
    if (!settings.target || (browser && !settings.browsers)) return false;
    const error = isReported(thrown) ? thrown : reportedError(thrown);
    if (!mayReport(`${options.source}|${options.where ?? ""}|${error.type}|${error.message.slice(0, 200)}`)) return false;
    const context: ErrorEventContext = { source: options.source, release: options.release ?? serverVersion().version, environment: settings.environment, where: options.where, tags: options.tags };
    const event = errorEvent(error, context);
    const response = await providerFetch(settings.target.endpoint, { method: "POST", headers: errorEnvelopeHeaders(settings.target), body: errorEnvelope(event, settings.target) });
    if (!response.ok) logger.warn(`Error report refused: ${response.status} from ${new URL(settings.target.endpoint).host}`);
    return response.ok;
  } catch (err) {
    logger.warn(`Couldn't send an error report: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function isReported(value: unknown): value is ReportedError {
  return !(value instanceof Error) && !!value && typeof value === "object" && typeof (value as ReportedError).type === "string" && typeof (value as ReportedError).message === "string";
}

/**
 * The process's own last resort (the API's or the Worker's): an exception
 * nothing caught, or a promise rejected with nobody waiting. Node ends the
 * process for either; it still does, once the report had a moment to go.
 */
export function reportProcessErrors(source: "api" | "worker") {
  const fatal = (err: unknown, where: "uncaughtException" | "unhandledRejection") => {
    logger.error(`${where}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    void Promise.race([reportError(err, { source, where }), new Promise((done) => setTimeout(done, 2000))]).finally(() => process.exit(1));
  };
  process.on("uncaughtException", (err) => fatal(err, "uncaughtException"));
  process.on("unhandledRejection", (reason) => fatal(reason, "unhandledRejection"));
}
