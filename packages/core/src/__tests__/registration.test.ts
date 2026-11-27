import { describe, expect, it } from "vite-plus/test";
import { answersProblem, placesFit, placesLeftOf, placesProblem, placesTaken, priceOf, promotions, registrationState, type PlaceKind, type RegistrationQuestion } from "../calendar/registration.js";
import { CreateTeamEventSchema } from "../requests/events.js";
import { RegisterSchema, RegistrationFormSchema } from "../requests/registrations.js";

const adult: PlaceKind = { id: "adult", name: "Adult", limit: null, price: 2500 };
const child: PlaceKind = { id: "child", name: "Child", limit: 10, price: 1000 };
const bus: PlaceKind = { id: "bus", name: "Bus seat", limit: 3, price: null };
const weekend = { limit: 20, placeKinds: [adult, child, bus] };

describe("places", () => {
  it("counts only confirmed registrations", () => {
    const taken = placesTaken([
      { places: { adult: 2, child: 3 }, status: "CONFIRMED" },
      { places: { adult: 4 }, status: "WAITING" },
      { places: { adult: 1 }, status: "CANCELLED" },
    ]);
    expect(taken).toEqual({ total: 5, byKind: { adult: 2, child: 3 } });
    expect(placesLeftOf(weekend, taken)).toEqual({ total: 15, byKind: { adult: null, child: 7, bus: 3 } });
  });
  it("refuses more than a kind's or the date's places", () => {
    const taken = { total: 18, byKind: { adult: 16, bus: 2 } };
    expect(placesFit(weekend, taken, { adult: 2 })).toBe(true);
    expect(placesFit(weekend, taken, { adult: 3 })).toBe(false);
    expect(placesFit(weekend, taken, { bus: 2 })).toBe(false);
    expect(placesFit({ limit: null, placeKinds: [adult] }, { total: 500, byKind: { adult: 500 } }, { adult: 50 })).toBe(true);
  });
  it("lets waiting registrations in, in order, each that fits", () => {
    const confirmed = [{ places: { adult: 16 } }];
    const waiting = [
      { id: "family", places: { adult: 2, child: 4 } },
      { id: "couple", places: { adult: 2 } },
      { id: "single", places: { adult: 1 } },
      { id: "another", places: { adult: 1 } },
    ];
    expect(promotions(weekend, confirmed, waiting)).toEqual(["couple", "single", "another"]);
  });
  it("checks the kinds and counts asked for", () => {
    expect(placesProblem(weekend.placeKinds, { adult: 1 })).toBeNull();
    expect(placesProblem(weekend.placeKinds, { adult: 0 })).toMatch(/at least one/);
    expect(placesProblem(weekend.placeKinds, { meal: 1 })).toMatch(/meal/);
    expect(placesProblem(weekend.placeKinds, { adult: 51 })).toMatch(/50/);
  });
  it("adds up the prices of the priced kinds", () => {
    expect(priceOf(weekend.placeKinds, { adult: 2, child: 1, bus: 3 })).toBe(6000);
    expect(priceOf(weekend.placeKinds, { bus: 1 })).toBeNull();
  });
});

describe("answers", () => {
  const questions: RegistrationQuestion[] = [
    { id: "diet", label: "Diet", type: "choice", options: ["None", "Vegetarian"], required: true },
    { id: "age", label: "Youngest child's age", type: "number", required: false },
    { id: "photos", label: "Photos allowed", type: "yesno", required: true },
  ];
  it("asks every required question, each as its type", () => {
    expect(answersProblem(questions, { diet: "Vegetarian", photos: false })).toBeNull();
    expect(answersProblem(questions, { photos: true })).toBe("Diet must be answered");
    expect(answersProblem(questions, { diet: "Vegan" })).toBe("Diet must be one of its options");
    expect(answersProblem(questions, { diet: "None", age: "4" })).toBe("Youngest child's age must be a number");
    expect(answersProblem(questions, { diet: "None", other: "x" })).toMatch(/other/);
  });
});

describe("registrationState", () => {
  const startsAt = "2027-05-14T17:00:00.000Z";
  it("opens some days before and closes some hours before the start", () => {
    const window = { open: true, opensDaysBefore: 30, closesHoursBefore: 48 };
    expect(registrationState(window, startsAt, "2027-04-01T00:00:00Z")).toBe("notYet");
    expect(registrationState(window, startsAt, "2027-05-01T00:00:00Z")).toBe("open");
    expect(registrationState(window, startsAt, "2027-05-13T00:00:00Z")).toBe("closed");
    expect(registrationState({ ...window, open: false }, startsAt, "2027-05-01T00:00:00Z")).toBe("closed");
    expect(registrationState({ open: true, opensDaysBefore: null, closesHoursBefore: 0 }, startsAt, "2026-01-01T00:00:00Z")).toBe("open");
  });
});

describe("requests", () => {
  it("takes an event date of up to 14 days", () => {
    const event = { title: "Church weekend", date: "2027-05-14", startTime: "19:00", timeZone: "Europe/Paris" };
    expect(CreateTeamEventSchema.safeParse({ ...event, durationMinutes: 2 * 24 * 60 }).success).toBe(true);
    expect(CreateTeamEventSchema.safeParse({ ...event, durationMinutes: 15 * 24 * 60 }).success).toBe(false);
  });
  it("needs a place kind, and options for a choice", () => {
    const form = { teamEventId: "e1", placeKinds: [{ name: "Adult" }] };
    expect(RegistrationFormSchema.safeParse(form).success).toBe(true);
    expect(RegistrationFormSchema.safeParse({ ...form, placeKinds: [] }).success).toBe(false);
    expect(RegistrationFormSchema.safeParse({ ...form, questions: [{ label: "Diet", type: "choice" }] }).success).toBe(false);
    expect(RegistrationFormSchema.safeParse({ placeKinds: [{ name: "Adult" }] }).success).toBe(false);
  });
  it("takes a name, an email and places", () => {
    expect(RegisterSchema.safeParse({ name: "Ana", email: "ana@example.com", places: { adult: 2 } }).success).toBe(true);
    expect(RegisterSchema.safeParse({ name: "Ana", email: "nope", places: { adult: 2 } }).success).toBe(false);
  });
});
