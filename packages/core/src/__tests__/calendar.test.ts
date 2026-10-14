import { describe, expect, it } from "vite-plus/test";
import { callAt, eventDates, swapWidensAt, eventFallsOn, isPastDate, localDate, zonedInstant } from "../calendar/index.js";
import en from "../i18n/locales/en.js";
import { notificationText } from "../notifications/index.js";
import { CreateTeamEventSchema } from "../requests/events.js";

describe("zonedInstant", () => {
  it("keeps the wall-clock time across daylight saving", () => {
    expect(zonedInstant("2026-07-05", "10:00", "Europe/Paris")).toBe("2026-07-05T08:00:00.000Z");
    expect(zonedInstant("2026-12-06", "10:00", "Europe/Paris")).toBe("2026-12-06T09:00:00.000Z");
  });
  it("takes a skipped time an hour later, and a doubled one as the first", () => {
    expect(zonedInstant("2026-03-29", "02:30", "Europe/Paris")).toBe("2026-03-29T01:30:00.000Z");
    expect(zonedInstant("2026-10-25", "02:30", "Europe/Paris")).toBe("2026-10-25T00:30:00.000Z");
  });
});

describe("eventDates", () => {
  const sundays = { date: "2026-10-11", startTime: "10:00", durationMinutes: 120, timeZone: "Europe/Paris", repeat: { everyWeeks: 1 } };
  it("lists every Sunday at 10:00 local time, before and after the clocks go back", () => {
    const dates = eventDates(sundays, "2026-10-12", "2026-11-01");
    expect(dates.map((d) => d.date)).toEqual(["2026-10-18", "2026-10-25", "2026-11-01"]);
    expect(dates.map((d) => d.startsAt)).toEqual(["2026-10-18T08:00:00.000Z", "2026-10-25T09:00:00.000Z", "2026-11-01T09:00:00.000Z"]);
    expect(dates[0]!.endsAt).toBe("2026-10-18T10:00:00.000Z");
  });
  it("applies a date's own changes and stops at its last date", () => {
    const dates = eventDates({ ...sundays, repeat: { everyWeeks: 2, until: "2026-11-08" } }, "2026-10-01", "2026-12-31", [
      { date: "2026-10-25", cancelled: true },
      { date: "2026-11-08", startTime: "09:00" },
    ]);
    expect(dates.map((d) => [d.date, d.cancelled, d.changed, d.startTime])).toEqual([
      ["2026-10-11", false, false, "10:00"],
      ["2026-10-25", true, false, "10:00"],
      ["2026-11-08", false, true, "09:00"],
    ]);
  });
  it("knows whether an event falls on a date", () => {
    expect(eventFallsOn(sundays, "2026-10-18")).toBe(true);
    expect(eventFallsOn(sundays, "2026-10-19")).toBe(false);
    expect(eventFallsOn({ ...sundays, repeat: null }, "2026-10-18")).toBe(false);
  });
});

describe("dates in a time zone", () => {
  it("is still coming on the day, past the day after", () => {
    expect(localDate("2026-10-12T02:00:00.000Z", "America/New_York")).toBe("2026-10-11");
    expect(isPastDate("2026-10-11", "2026-10-11T21:00:00.000Z", "Europe/Paris")).toBe(false);
    expect(isPastDate("2026-10-11", "2026-10-11T23:30:00.000Z", "Europe/Paris")).toBe(true);
  });
});

describe("CreateTeamEventSchema", () => {
  it("refuses dates, times and zones that aren't", () => {
    const result = CreateTeamEventSchema.safeParse({ title: "x", date: "2026-02-30", startTime: "25:00", timeZone: "Mars/Olympus" });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.message)).toEqual(["date must be a date, YYYY-MM-DD", "startTime must be a time, HH:MM", "timeZone must be a time zone, like Europe/Paris"]);
  });
});

describe("call time (issue #240)", () => {
  it("is that many minutes before the start, or none", () => {
    expect(callAt("2026-03-01T09:00:00.000Z", 45)).toBe("2026-03-01T08:15:00.000Z");
    expect(callAt("2026-03-01T09:00:00.000Z", null)).toBeNull();
  });

  it("is in the day-before reminder", () => {
    const data = { event: "Service", date: "2026-03-01", team: "Band", startTime: "10:00", callTime: "09:15" };
    expect(notificationText("EVENT_TOMORROW", data, en, "en").body).toBe("Band · call time 09:15");
    expect(notificationText("EVENT_TOMORROW", { ...data, callTime: undefined }, en, "en").body).toBe("Band");
  });

  it("is minutes, up to eight hours", () => {
    const base = { title: "Service", date: "2026-03-01", startTime: "10:00", timeZone: "Europe/Paris" };
    expect(CreateTeamEventSchema.safeParse({ ...base, callMinutes: 45 }).success).toBe(true);
    expect(CreateTeamEventSchema.safeParse({ ...base, callMinutes: 481 }).success).toBe(false);
  });
});

describe("swaps: If needed first (issue #240)", () => {
  it("for a day, or two hours when the date is less than two days away", () => {
    expect(swapWidensAt("2026-03-01T10:00:00.000Z", "2026-03-08T10:00:00.000Z")).toBe("2026-03-02T10:00:00.000Z");
    expect(swapWidensAt("2026-03-01T10:00:00.000Z", "2026-03-02T10:00:00.000Z")).toBe("2026-03-01T12:00:00.000Z");
  });
});
