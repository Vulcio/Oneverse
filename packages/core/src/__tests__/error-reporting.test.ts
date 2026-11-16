import { describe, expect, it } from "vite-plus/test";
import { errorEnvelope, errorEvent, parseDsn, pathPattern, reportedError, scrubText, stackFrames } from "../error-reporting/index.js";
import { ErrorReportSchema, SaveErrorReportingSettingsSchema } from "../requests/index.js";

describe("error reporting (issue #469)", () => {
  it("reads a DSN: Sentry's, GlitchTip's, one under a path", () => {
    expect(parseDsn("https://abc123@o1.ingest.sentry.io/4507")).toMatchObject({ endpoint: "https://o1.ingest.sentry.io/api/4507/envelope/", publicKey: "abc123", projectId: "4507" });
    expect(parseDsn("https://key@glitchtip.example.org/3")?.endpoint).toBe("https://glitchtip.example.org/api/3/envelope/");
    expect(parseDsn("http://key@localhost:8000/errors/7")?.endpoint).toBe("http://localhost:8000/errors/api/7/envelope/");
    for (const bad of ["", "nonsense", "https://host/3", "ftp://k@host/3", "https://k@host/", "https://k@host/3?x=1"]) expect(parseDsn(bad)).toBeNull();
  });

  it("takes emails, tokens and query strings out", () => {
    const text = scrubText("Can't send to ana@example.com at https://api.oneverse.top/files/x?sig=abc&exp=1 with Bearer eyJhbGciOi.eyJzdWIiOiJ4In0.sig token=s3cr3t");
    expect(text).not.toMatch(/ana@|sig=abc|eyJ|s3cr3t/);
    expect(text).toContain("[email]");
    expect(text).toContain("https://api.oneverse.top/files/x ");
    expect(scrubText("key 0123456789abcdef0123456789abcdef0123")).toBe("key [redacted]");
    expect(scrubText('{"password":"hunter2"}')).toBe('{"password":"[redacted]"}');
  });

  it("reads V8's and Firefox's stacks, oldest frame first", () => {
    const v8 = stackFrames("TypeError: x is undefined\n    at play (https://songverse.top/assets/live-abc.js:10:5)\n    at https://songverse.top/assets/index.js:2:30\n    at run (node:internal/timers:5:1)");
    expect(v8).toEqual([
      { function: "run", filename: "node:internal/timers", lineno: 5, colno: 1, in_app: false },
      { filename: "https://songverse.top/assets/index.js", lineno: 2, colno: 30, in_app: true },
      { function: "play", filename: "https://songverse.top/assets/live-abc.js", lineno: 10, colno: 5, in_app: true },
    ]);
    expect(stackFrames("play@https://songverse.top/a.js?v=1:3:4\n@https://songverse.top/b.js:1:1")).toEqual([
      { filename: "https://songverse.top/b.js", lineno: 1, colno: 1, in_app: true },
      { function: "play", filename: "https://songverse.top/a.js", lineno: 3, colno: 4, in_app: true },
    ]);
  });

  it("makes an event with nothing personal in it, and an envelope for it", () => {
    const error = new TypeError("No user ana@example.com");
    const event = errorEvent(reportedError(error), { source: "api", release: "0.10.0-dev", environment: "production", where: "GET /setlists/:id?token=x", tags: { queue: "lookups" }, eventId: "a".repeat(32), timestamp: 1 });
    expect(event).toMatchObject({ event_id: "a".repeat(32), platform: "node", level: "error", release: "0.10.0-dev", environment: "production", transaction: "GET /setlists/:id", tags: { source: "api", queue: "lookups" } });
    expect(event.exception.values[0]).toMatchObject({ type: "TypeError", value: "No user [email]" });
    expect(event.exception.values[0]!.stacktrace?.frames.length).toBeGreaterThan(0);
    expect(JSON.stringify(event)).not.toMatch(/user\b"|request|ana@/);
    const target = parseDsn("https://key@host/1")!;
    const [header, item, body] = errorEnvelope(event, target, new Date(0)).split("\n");
    expect(JSON.parse(header!)).toEqual({ event_id: "a".repeat(32), sent_at: "1970-01-01T00:00:00.000Z", dsn: "https://key@host/1" });
    expect(JSON.parse(item!)).toEqual({ type: "event" });
    expect(JSON.parse(body!).event_id).toBe("a".repeat(32));
  });

  it("writes a path as its pattern: ids and tokens out, no query", () => {
    expect(pathPattern("/sets/cmwjjmpib020tryq29ru3tij8/live/cmwjjmphh020oryq29w9j75g8?from=x")).toBe("/sets/:id/live/:id");
    expect(pathPattern("/join/AbCdEfGhIjKlMnOpQrStUvWx")).toBe("/join/:id");
    expect(pathPattern("/library/songs")).toBe("/library/songs");
  });

  it("reads anything thrown", () => {
    expect(reportedError("boom")).toEqual({ type: "Error", message: "boom" });
    expect(reportedError({ code: 1 })).toEqual({ type: "Error", message: '{"code":1}' });
  });

  it("checks a browser's report and the admin's settings", () => {
    expect(ErrorReportSchema.safeParse({ app: "web", type: "TypeError", message: "x" }).success).toBe(true);
    expect(ErrorReportSchema.safeParse({ app: "web", type: "TypeError", message: "x", user: "ana" }).success).toBe(false);
    expect(SaveErrorReportingSettingsSchema.safeParse({ dsn: "https://key@glitchtip.example.org/3" }).success).toBe(true);
    expect(SaveErrorReportingSettingsSchema.safeParse({ dsn: "" }).success).toBe(true);
    expect(SaveErrorReportingSettingsSchema.safeParse({ dsn: "https://glitchtip.example.org/3" }).success).toBe(false);
  });
});
