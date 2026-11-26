import { describe, expect, it } from "vite-plus/test";
import { bookingClashes, type Holder } from "./bookings.js";

const hall = { id: "hall", name: "Main hall", setupMinutes: 30, teardownMinutes: 15 };
const kids = { id: "kids", name: "Kids room", setupMinutes: 0, teardownMinutes: 0 };
const van = (quantity: number, available = 2) => ({ resourceId: "van", name: "Van", quantity, available });

function holder(key: string, startsAt: string, endsAt: string, more: Partial<Holder> = {}): Holder {
  return { key, kind: "team", eventId: key, title: key, owner: "Team", rooms: [], resources: [], dates: [{ date: startsAt.slice(0, 10), startsAt, endsAt, title: null }], ...more };
}

describe("bookingClashes", () => {
  it("refuses a room two events hold at once, naming the other", () => {
    const subject = holder("concert", "2026-12-06T18:00:00.000Z", "2026-12-06T20:00:00.000Z", { rooms: [hall] });
    const other = holder("service", "2026-12-06T19:00:00.000Z", "2026-12-06T21:00:00.000Z", { rooms: [hall], owner: "Worship" });
    expect(bookingClashes(subject, [other])).toMatchObject([{ date: "2026-12-06", kind: "room", what: "Main hall", event: "service", owner: "Worship" }]);
  });

  it("counts the room's setup and teardown", () => {
    // Ends 18:00, torn down by 18:15; the next is set up from 17:50 (setup 30 before 18:20): they meet.
    const subject = holder("a", "2026-12-06T16:00:00.000Z", "2026-12-06T18:00:00.000Z", { rooms: [hall] });
    expect(bookingClashes(subject, [holder("b", "2026-12-06T18:20:00.000Z", "2026-12-06T19:00:00.000Z", { rooms: [hall] })])).toHaveLength(1);
    // Starting 18:45, set up from 18:15: free.
    expect(bookingClashes(subject, [holder("b", "2026-12-06T18:45:00.000Z", "2026-12-06T19:00:00.000Z", { rooms: [hall] })])).toHaveLength(0);
    // A room without setup or teardown: back to back is fine.
    const room = holder("c", "2026-12-06T16:00:00.000Z", "2026-12-06T18:00:00.000Z", { rooms: [kids] });
    expect(bookingClashes(room, [holder("d", "2026-12-06T18:00:00.000Z", "2026-12-06T19:00:00.000Z", { rooms: [kids] })])).toHaveLength(0);
  });

  it("leaves other rooms and the same booking alone", () => {
    const subject = holder("a", "2026-12-06T18:00:00.000Z", "2026-12-06T20:00:00.000Z", { rooms: [hall] });
    expect(bookingClashes(subject, [holder("b", "2026-12-06T18:00:00.000Z", "2026-12-06T20:00:00.000Z", { rooms: [kids] })])).toHaveLength(0);
    expect(bookingClashes(subject, [{ ...subject }])).toHaveLength(0);
  });

  it("books a resource while there are enough of it at once", () => {
    const subject = holder("a", "2026-12-06T09:00:00.000Z", "2026-12-06T12:00:00.000Z", { resources: [van(1)] });
    // One van 9-10, another 11-12: never two at once, so a third fits beside them.
    const early = holder("b", "2026-12-06T09:00:00.000Z", "2026-12-06T10:00:00.000Z", { resources: [van(1)] });
    const late = holder("c", "2026-12-06T11:00:00.000Z", "2026-12-06T12:00:00.000Z", { resources: [van(1)] });
    expect(bookingClashes(subject, [early, late])).toHaveLength(0);
    // Two at once at 9: none left.
    const both = holder("d", "2026-12-06T09:30:00.000Z", "2026-12-06T10:30:00.000Z", { resources: [van(1)] });
    expect(bookingClashes(subject, [early, both]).map((clash) => clash.eventId)).toEqual(["b", "d"]);
    // Asking for both vans while one is out.
    expect(bookingClashes(holder("e", "2026-12-06T09:00:00.000Z", "2026-12-06T12:00:00.000Z", { resources: [van(2)] }), [late])).toHaveLength(1);
  });
});
