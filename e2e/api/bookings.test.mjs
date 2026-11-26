// Bookings (issue #565, ADR 0013): an event's dates book its rooms - from the room's setup time before to its
// teardown after - and its resources. A second booking at the same time is refused (409), naming the event and the
// team holding it; a series can book only its free dates instead (skipClashes: its clashing dates cancelled). An
// organisation's event books once for all its groups. A date brought back, moved or given another time is checked too.
import { call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const plus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const admin = await user("Bookings global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true, reviewRequests: false });
const lead = await user("Bookings lead");
const org = (await call(lead, "POST", "/organizations", { name: `Booking church ${stamp}` })).body;
const worship = (await call(lead, "POST", "/teams", { name: `Worship ${stamp}` })).body;
const youth = (await call(lead, "POST", "/teams", { name: `Youth ${stamp}` })).body;
for (const team of [worship, youth]) await call(lead, "PUT", `/teams/${team.id}/organization`, { organizationId: org.id });
const campus = (await call(lead, "POST", "/locations", { name: "Campus", timeZone: "Europe/Paris", organizationId: org.id })).body;
const hall = (await call(lead, "POST", `/locations/${campus.id}/rooms`, { name: "Main hall", setupMinutes: 30, teardownMinutes: 30 })).body.rooms.find((room) => room.name === "Main hall");
const kids = (await call(lead, "POST", `/locations/${campus.id}/rooms`, { name: "Kids room" })).body.rooms.find((room) => room.name === "Kids room");
const vans = (await call(lead, "POST", "/resources", { name: "Van", quantity: 2, organizationId: org.id })).body;
const at = (team) => `/teams/${team.id}/events`;
const base = { timeZone: "Europe/Paris", locationId: campus.id, durationMinutes: 120 };

// --- rooms
const first = plus(7);
let r = await call(lead, "POST", at(worship), { ...base, title: "Sunday service", date: first, startTime: "10:00", roomIds: [hall.id], repeat: { everyWeeks: 1 } });
const sunday = r.body;
check("a weekly service books the hall", r.status === 201, JSON.stringify(r.body));
r = await call(lead, "POST", at(youth), { ...base, title: "Youth brunch", date: plus(14), startTime: "11:00", roomIds: [hall.id] });
check("the hall at the same time is refused", r.status === 409 && r.body.code === "BOOKING_CLASH", JSON.stringify(r.body));
check("…naming the event and the team holding it", r.body.message?.[0] === `Main hall is booked on ${plus(14)} by Sunday service (Worship ${stamp})` && r.body.clashes?.[0]?.eventId === sunday.id, JSON.stringify(r.body));
r = await call(lead, "POST", at(youth), { ...base, title: "Youth brunch", date: plus(14), startTime: "12:15", roomIds: [hall.id] });
check("…and during the room's teardown (12:00 + 30 minutes)", r.status === 409, JSON.stringify(r.body));
r = await call(lead, "POST", at(youth), { ...base, title: "Youth brunch", date: plus(14), startTime: "13:00", roomIds: [hall.id] });
const brunch = r.body;
check("once it's set up and cleared, it's free", r.status === 201, JSON.stringify(r.body));
r = await call(lead, "POST", at(youth), { ...base, title: "Kids club", date: plus(14), startTime: "10:00", roomIds: [kids.id] });
check("another room at the same time is free", r.status === 201, JSON.stringify(r.body));
r = await call(lead, "PATCH", `${at(youth)}/${brunch.id}`, { startTime: "11:30" });
check("moving an event onto a booking is refused", r.status === 409, JSON.stringify(r.body));
r = await call(lead, "GET", `${at(youth)}/${brunch.id}`);
check("…and nothing of the change is kept", r.body.startTime === "13:00", JSON.stringify(r.body));
r = await call(lead, "PATCH", `${at(youth)}/${brunch.id}/dates/${plus(14)}`, { startTime: "10:30" });
check("one date at another time is checked too", r.status === 409, JSON.stringify(r.body));

// --- a series: book its free dates
r = await call(lead, "POST", at(youth), { ...base, title: "Youth worship", date: first, startTime: "11:00", roomIds: [hall.id], repeat: { everyWeeks: 1, until: plus(28) } });
check("a series clashing on every date is refused, its dates listed", r.status === 409 && new Set(r.body.clashes.map((one) => one.date)).size === 4 && r.body.freeDates === 0, JSON.stringify(r.body));
r = await call(lead, "PATCH", `${at(worship)}/${sunday.id}/dates/${plus(21)}`, { cancelled: true });
check("the service cancelled one Sunday", r.status === 200 && r.body.cancelled, JSON.stringify(r.body));
r = await call(lead, "POST", at(youth), { ...base, title: "Youth worship", date: first, startTime: "11:00", roomIds: [hall.id], repeat: { everyWeeks: 1, until: plus(28) }, skipClashes: true });
const youthWorship = r.body;
check("skipClashes books the free dates", r.status === 201, JSON.stringify(r.body));
r = await call(lead, "GET", `/teams/${youth.id}/event-dates?from=${first}&to=${plus(28)}`);
const ours = r.body.filter((one) => one.eventId === youthWorship.id);
check("…its clashing dates cancelled, the free one kept", ours.length === 4 && ours.filter((one) => !one.cancelled).map((one) => one.date).join() === plus(21), JSON.stringify(ours));
r = await call(lead, "PATCH", `${at(worship)}/${sunday.id}/dates/${plus(21)}`, { cancelled: false });
check("bringing back a date that's been booked since is refused", r.status === 409 && r.body.message[0].includes("Youth worship"), JSON.stringify(r.body));
r = await call(lead, "POST", `${at(youth)}/${brunch.id}/dates/${plus(14)}/move`, { to: plus(21) });
check("moving a date onto a booking is refused", r.status === 409, JSON.stringify(r.body));
r = await call(lead, "POST", at(youth), { ...base, title: "One-off", date: plus(35), startTime: "10:00", roomIds: [hall.id], skipClashes: true });
check("a one-off can't skip its clash", r.status === 409, JSON.stringify(r.body));

// --- resources
const day = plus(40);
r = await call(lead, "POST", at(worship), { ...base, title: "Outreach", date: day, startTime: "09:00", resources: [{ resourceId: vans.id }] });
check("one van out", r.status === 201, JSON.stringify(r.body));
r = await call(lead, "POST", at(youth), { ...base, title: "Camp drop-off", date: day, startTime: "10:00", resources: [{ resourceId: vans.id }] });
check("the second van too", r.status === 201, JSON.stringify(r.body));
r = await call(lead, "POST", at(youth), { ...base, title: "Third trip", date: day, startTime: "10:30", resources: [{ resourceId: vans.id }] });
check("no third: refused, naming both", r.status === 409 && r.body.clashes.length === 2 && r.body.message[0].startsWith("Van is booked"), JSON.stringify(r.body));
r = await call(lead, "POST", at(youth), { ...base, title: "Afternoon trip", date: day, startTime: "12:00", resources: [{ resourceId: vans.id }] });
check("from noon both are back", r.status === 201, JSON.stringify(r.body));

// --- an organisation's event books once for all its groups
const orgDay = plus(50);
const events = `/organizations/${org.id}/events`;
r = await call(lead, "POST", events, { ...base, title: "Carol service", date: orgDay, startTime: "18:00", hostUserId: lead.id, needs: [{ teamId: worship.id }, { teamId: youth.id }], roomIds: [hall.id], resources: [{ resourceId: vans.id, quantity: 2 }] });
const carols = r.body;
check("an organisation's event with two groups books the hall once", r.status === 201, JSON.stringify(r.body));
r = await call(lead, "POST", at(youth), { ...base, title: "Rehearsal", date: orgDay, startTime: "19:00", roomIds: [hall.id] });
check("a group's own event in it is refused, naming the organisation", r.status === 409 && r.body.message[0].includes(`Carol service (Booking church ${stamp})`), JSON.stringify(r.body));
r = await call(lead, "POST", at(youth), { ...base, title: "Pick-up", date: orgDay, startTime: "17:00", resources: [{ resourceId: vans.id }] });
check("both vans are out with it", r.status === 409, JSON.stringify(r.body));
r = await call(lead, "PATCH", `${events}/${carols.id}`, { startTime: "18:30" });
check("changing it doesn't clash with its own groups' parts", r.status === 200, JSON.stringify(r.body));
r = await call(lead, "POST", events, { ...base, title: "Prayer night", date: orgDay, startTime: "20:00", hostUserId: lead.id, needs: [{ teamId: worship.id }], roomIds: [hall.id] });
check("another organisation event in the hall then is refused", r.status === 409, JSON.stringify(r.body));

finish();
