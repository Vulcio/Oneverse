/**
 * Error reporting (issue #469): an error as an event of the Sentry protocol,
 * which Sentry and GlitchTip (self-hostable) both take, sent to the address
 * a DSN names. Only the protocol, no SDK: the server sends every report -
 * the API's, the Worker's, and the browsers' through the API - so what
 * leaves is scrubbed in one place and nothing is sent without a DSN.
 *
 * Nothing personal in a report: no request bodies, headers, query strings,
 * cookies or user ids, and emails and tokens taken out of messages and stacks.
 */

/** Where a DSN sends its events, and the key it sends them with. */
export interface ErrorReportingTarget {
  /** The project's envelope endpoint: `https://host/api/<project>/envelope/`. */
  endpoint: string;
  publicKey: string;
  projectId: string;
  /** The DSN itself, as the envelope's header carries it. */
  dsn: string;
}

/**
 * A DSN read: `https://<key>@<host>[:port][/<path>]/<project>`. Null when it
 * isn't one (not http(s), no key, no project).
 */
export function parseDsn(input: string | null | undefined): ErrorReportingTarget | null {
  const dsn = input?.trim();
  if (!dsn) return null;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.username || url.search || url.hash) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const projectId = parts.pop();
  if (!projectId || !/^[\w-]{1,64}$/.test(projectId)) return null;
  const prefix = parts.length ? `/${parts.join("/")}` : "";
  return { endpoint: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`, publicKey: decodeURIComponent(url.username), projectId, dsn };
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
/** `token=…`, `key: …`, `"password":"…"` and the like. */
const SECRET_FIELD = /\b(token|key|secret|password|passwd|signature|sig|code|auth|authorization|cookie|session)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi;
/** Long runs of hex or base64: keys, signatures, file tokens. */
const LONG_SECRET = /\b[A-Za-z0-9_-]{40,}\b|\b[A-Fa-f0-9]{32,}\b/g;
/** A query string, on an address in a message or a stack. */
const QUERY = /(https?:\/\/[^\s?#"']+|\/[^\s?#"']*)\?[^\s#"')]*/g;

/** Text with what may be personal or secret taken out: emails, tokens, query strings. */
export function scrubText(text: string): string {
  return text
    .replace(QUERY, "$1")
    .replace(JWT, "[token]")
    .replace(BEARER, "$1 [token]")
    .replace(SECRET_FIELD, "$1$2[redacted]")
    .replace(EMAIL, "[email]")
    .replace(LONG_SECRET, "[redacted]");
}

/**
 * A page's or a request's path as a pattern (issue #469): its query left out,
 * and segments that look like ids or tokens (16 characters or more with a
 * digit, or 24 and more of anything) written `:id`, so an invitation's token
 * or a file's signature never leaves.
 */
export function pathPattern(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? "";
  return bare
    .split("/")
    .map((segment) => ((segment.length >= 16 && /\d/.test(segment)) || segment.length >= 24 ? ":id" : segment))
    .join("/")
    .slice(0, 300);
}

/** A stack frame as the protocol has it. */
export interface ErrorFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const GECKO_FRAME = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/;

/**
 * A stack's frames, oldest first as the protocol wants them, from V8's
 * (Chrome, Node) or Firefox's and Safari's way of writing them. Lines that
 * aren't frames are left out; at most 50 frames, the newest kept.
 */
export function stackFrames(stack: string | null | undefined): ErrorFrame[] {
  if (!stack) return [];
  const frames: ErrorFrame[] = [];
  for (const line of stack.split("\n")) {
    const match = V8_FRAME.exec(line) ?? GECKO_FRAME.exec(line);
    if (!match) continue;
    const [, fn, file, lineno, colno] = match;
    const filename = scrubText(file!.replace(/^file:\/\//, ""));
    frames.push({
      ...(fn && { function: fn }),
      filename,
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: !/node_modules|^node:|^internal\//.test(filename),
    });
    if (frames.length >= 50) break;
  }
  return frames.reverse();
}

/** Where a report comes from. */
export const ERROR_REPORT_SOURCES = ["api", "worker", "web", "planiverse", "oneverse", "screen"] as const;
export type ErrorReportSource = (typeof ERROR_REPORT_SOURCES)[number];

/** An error, as reported: its kind, its message and its stack, as text. */
export interface ReportedError {
  type: string;
  message: string;
  stack?: string | null;
}

/** An error, or anything thrown, as a report: its name, message and stack. */
export function reportedError(thrown: unknown): ReportedError {
  if (thrown instanceof Error) return { type: thrown.name || "Error", message: thrown.message, stack: thrown.stack ?? null };
  if (typeof thrown === "string") return { type: "Error", message: thrown };
  let message: string;
  try {
    message = JSON.stringify(thrown) ?? String(thrown);
  } catch {
    message = String(thrown);
  }
  return { type: "Error", message };
}

/** What an event says beside the error. */
export interface ErrorEventContext {
  source: ErrorReportSource;
  /** The product's version (issue #164). */
  release: string;
  /** "production", "staging"… as the admin names it. */
  environment: string;
  /** Where it happened, without its query: a route's path, a job's queue and name. */
  where?: string | null;
  /** Small labels to sort by: the queue, the HTTP method. Values cut to 200 characters. */
  tags?: Record<string, string>;
  /** A random 32-character hex id; one is made when left out. */
  eventId?: string;
  /** Seconds since the epoch; now when left out. */
  timestamp?: number;
}

/** A random event id: 32 hex characters. */
export function errorEventId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The protocol's event for an error: scrubbed, with no user, request or device details. */
export function errorEvent(error: ReportedError, context: ErrorEventContext) {
  const frames = stackFrames(error.stack);
  const tags = Object.fromEntries(Object.entries({ source: context.source, ...context.tags }).map(([key, value]) => [cut(key, 32), cut(scrubText(value), 200)]));
  return {
    event_id: context.eventId ?? errorEventId(),
    timestamp: context.timestamp ?? Date.now() / 1000,
    platform: context.source === "api" || context.source === "worker" ? "node" : "javascript",
    level: "error",
    logger: context.source,
    release: cut(context.release, 64),
    environment: cut(context.environment, 64),
    ...(context.where && { transaction: cut(scrubText(context.where), 200) }),
    tags,
    exception: {
      values: [
        {
          type: cut(error.type || "Error", 200),
          value: cut(scrubText(error.message || ""), 2000),
          ...(frames.length && { stacktrace: { frames } }),
        },
      ],
    },
  };
}

export type ErrorReportEvent = ReturnType<typeof errorEvent>;

/** The body to POST to the target's endpoint: one envelope with one event. */
export function errorEnvelope(event: ErrorReportEvent, target: ErrorReportingTarget, sentAt = new Date()): string {
  return [JSON.stringify({ event_id: event.event_id, sent_at: sentAt.toISOString(), dsn: target.dsn }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
}

/** The headers that go with it: the key, as the protocol's auth header. */
export function errorEnvelopeHeaders(target: ErrorReportingTarget, client = "oneverse/1"): Record<string, string> {
  return {
    "Content-Type": "application/x-sentry-envelope",
    "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=${client}`,
  };
}
