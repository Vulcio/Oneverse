// A team's calendar (issue #235): events one-off or every n weeks, the
// team's dates in a range, a date changed or cancelled by itself, and each
// date's set - made as far ahead as the team says (1 to 52 weeks), named
// and dated after it, deleted while empty when its date goes, kept when it
// has songs. Every member sees the calendar; its admins manage it.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const today = new Date().toISOString().slice(0, 10);
const plus = (days) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

const admin = await user("calendar admin");
const member = await user("calendar member");
const outsider = await user("calendar outsider");
const team = (await call(admin, "POST", "/teams", { name: `Calendar ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const base = `/teams/${team.id}`;
const setsOf = () => sql(`select count(*) from "Setlist" s join "TeamEventDate" d on d."setlistId" = s.id join "TeamEvent" e on e.id = d."eventId" where e."teamId" = '${team.id}'`);

// --- who may
let r = await call(member, "POST", `${base}/events`, { title: "Nope", date: plus(1), startTime: "10:00", timeZone: "UTC" });
check("a member can't add an event", r.status === 403, String(r.status));
r = await call(outsider, "GET", `${base}/events`);
check("someone outside the team can't see its calendar", r.status === 403 || r.status === 404, String(r.status));
r = await call(admin, "POST", `${base}/events`, { title: "Bad", date: "2026-02-30", startTime: "25:00", timeZone: "Mars/Olympus" });
check("dates, times and zones that aren't are refused, by name", r.status === 400 && r.body.message.length === 3, JSON.stringify(r.body?.message));

// --- a weekly event: its sets 4 weeks ahead by default
r = await call(admin, "POST", `${base}/events`, { title: "Morning service", date: plus(1), startTime: "10:00", durationMinutes: 120, timeZone: "Europe/Paris", place: "Main hall", repeat: { everyWeeks: 1 } });
const weekly = r.body;
check("an admin adds a weekly event", r.status === 201 && weekly.repeat?.everyWeeks === 1 && weekly.place === "Main hall", JSON.stringify(r.body));
r = await call(member, "GET", `${base}/event-dates?from=${today}&to=${plus(60)}`);
const dates = r.body;
check("a member sees the team's dates in a range", r.status === 200 && dates.length >= 8 && dates[0].date === plus(1) && dates[1].date === plus(8), dates.map((d) => d.date).join(" "));
// Counted from today in Paris, the event's zone, which can already be tomorrow in UTC: a day's leeway.
const withSets = dates.filter((d) => d.setlistId);
check("each date in the next 4 weeks has its set, the later ones not yet", withSets.length >= 4 && withSets.length <= 5 && withSets.every((d) => d.date <= plus(29)), withSets.map((d) => d.date).join(" "));
const firstSet = (await call(member, "GET", `/setlists/${dates[0].setlistId}`)).body;
check("a date's set is the team's, named and dated after it, marked as the event's", firstSet.name === "Morning service" && firstSet.eventDate === plus(1) && firstSet.teamId === team.id && firstSet.fromEvent === true, JSON.stringify({ name: firstSet.name, eventDate: firstSet.eventDate, fromEvent: firstSet.fromEvent }));
r = await call(member, "GET", "/setlists");
check("…in the list of sets too; a set made by hand isn't", r.body.find((set) => set.id === firstSet.id)?.fromEvent === true && r.body.filter((set) => !set.fromEvent).every((set) => set.fromEvent === false));

// --- a call time (issue #240): when to be there, before it starts
r = await call(admin, "PATCH", `${base}/events/${weekly.id}`, { callMinutes: 600 });
check("a call time over 8 hours: refused", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "PATCH", `${base}/events/${weekly.id}`, { callMinutes: 45 });
check("a call time set", r.status === 200 && r.body.callMinutes === 45, JSON.stringify(r.body));
const called = (await call(member, "GET", `${base}/event-dates?from=${plus(1)}&to=${plus(1)}`)).body[0];
check("…each date says when to be there", called.callAt === new Date(Date.parse(called.startsAt) - 45 * 60000).toISOString(), JSON.stringify(called));
const mine = (await call(member, "GET", `/users/me/event-dates?from=${plus(1)}&to=${plus(1)}`)).body.find((d) => d.eventId === weekly.id);
check("…on My calendar too", mine?.callAt === called.callAt, JSON.stringify(mine));
r = await call(admin, "PATCH", `${base}/events/${weekly.id}`, { callMinutes: null });
check("…and cleared", r.body.callMinutes === null && (await call(member, "GET", `${base}/event-dates?from=${plus(1)}&to=${plus(1)}`)).body[0].callAt === null);

// --- further ahead, up to a year
r = await call(admin, "PUT", `${base}/calendar-settings`, { setsAheadWeeks: 60 });
check("more than a year ahead is refused", r.status === 400, String(r.status));
r = await call(admin, "PUT", `${base}/calendar-settings`, { setsAheadWeeks: 13 });
check("13 weeks ahead: about 3 months", r.status === 200 && r.body.setsAheadWeeks === 13);
const in3Months = (await call(member, "GET", `${base}/event-dates?from=${today}&to=${plus(120)}`)).body.filter((d) => d.setlistId);
check("the sets 3 months ahead are made at once", in3Months.length >= 13 && in3Months.every((d) => d.date <= plus(92)), String(in3Months.length));
r = await call(admin, "PUT", `${base}/calendar-settings`, { setsAheadWeeks: 4 });
check("nearer again: the sets already made stay", Number(setsOf()) >= 13, setsOf());

// --- one date changed, one cancelled
const second = plus(8);
r = await call(admin, "PATCH", `${base}/events/${weekly.id}/dates/${second}`, { title: "Harvest service", startTime: "09:30" });
check("one date gets its own title and time; its set follows", r.status === 200 && r.body.title === "Harvest service" && r.body.startTime === "09:30" && r.body.changed, JSON.stringify(r.body));
check("…its set renamed", (await call(member, "GET", `/setlists/${r.body.setlistId}`)).body.name === "Harvest service");
const third = plus(15);
const thirdSet = dates.find((d) => d.date === third).setlistId;
r = await call(admin, "PATCH", `${base}/events/${weekly.id}/dates/${third}`, { cancelled: true });
check("a date cancelled: its empty set deleted", r.status === 200 && r.body.cancelled && !r.body.setlistId && (await call(admin, "GET", `/setlists/${thirdSet}`)).status === 404, JSON.stringify(r.body));
r = await call(admin, "PATCH", `${base}/events/${weekly.id}/dates/${third}`, { cancelled: false });
check("…and back: a set again", r.status === 200 && !r.body.cancelled && !!r.body.setlistId, JSON.stringify(r.body));
r = await call(admin, "PATCH", `${base}/events/${weekly.id}/dates/${plus(9)}`, { cancelled: true });
check("a day the event isn't on", r.status === 404, String(r.status));

// --- a set someone deleted isn't made again; a planned set is kept
const fourth = plus(22);
const fourthSet = dates.find((d) => d.date === fourth).setlistId;
await call(admin, "DELETE", `/setlists/${fourthSet}`);
await call(admin, "PUT", `${base}/calendar-settings`, { setsAheadWeeks: 4 });
r = await call(member, "GET", `${base}/event-dates?from=${fourth}&to=${fourth}`);
check("a date's set deleted by hand isn't made again", r.body[0] && !r.body[0].setlistId, JSON.stringify(r.body));
r = await call(admin, "POST", `${base}/events/${weekly.id}/dates/${fourth}/set`);
check("…unless asked for", r.status === 201 && !!r.body.setlistId, JSON.stringify(r.body));
const askedSet = r.body.setlistId;

const song = (await call(admin, "POST", "/song-versions", { artists: ["Band"], title: `Calendar song ${stamp}`, language: "en", teamId: team.id })).body;
const plannedSet = (await call(member, "GET", `${base}/event-dates?from=${second}&to=${second}`)).body[0].setlistId;
await call(admin, "POST", `/setlists/${plannedSet}/items`, { songVersionId: song.id });

// --- every other week now: dates it no longer falls on leave it
r = await call(admin, "PATCH", `${base}/events/${weekly.id}`, { repeat: { everyWeeks: 2 }, title: "Sunday service" });
check("the event changed to every other week", r.status === 200 && r.body.repeat.everyWeeks === 2 && r.body.title === "Sunday service", `${r.status} ${JSON.stringify(r.body)}`);
const after = (await call(member, "GET", `${base}/event-dates?from=${today}&to=${plus(30)}`)).body;
check("its dates: every other week", after.map((d) => d.date).join() === [plus(1), plus(15), plus(29)].join(), after.map((d) => d.date).join(" "));
check("the dates left: the planned set kept as the team's, the empty ones gone", (await call(admin, "GET", `/setlists/${plannedSet}`)).status === 200 && (await call(admin, "GET", `/setlists/${askedSet}`)).status === 404);
check("the coming sets renamed", (await call(member, "GET", `/setlists/${after[0].setlistId}`)).body.name === "Sunday service");

// --- a one-off, and the time zone
r = await call(admin, "POST", `${base}/events`, { title: "Carol service", date: "2026-12-24", startTime: "18:00", timeZone: "Europe/Paris" });
const oneOff = (await call(member, "GET", `${base}/event-dates?from=2026-12-24&to=2026-12-24`)).body.find((d) => d.eventId === r.body.id);
check("a one-off at 18:00 in Paris: 17:00 UTC in winter, 90 minutes", oneOff?.startsAt === "2026-12-24T17:00:00.000Z" && oneOff.endsAt === "2026-12-24T18:30:00.000Z", JSON.stringify(oneOff));
r = await call(member, "GET", `${base}/event-dates?from=2026-01-01&to=2027-12-31`);
check("a range longer than 400 days is refused", r.status === 400, String(r.status));

// --- the event deleted: coming empty sets go, planned ones stay
r = await call(admin, "DELETE", `${base}/events/${weekly.id}`);
check("the event deleted", r.status === 204);
check("…its planned set stays the team's", (await call(admin, "GET", `/setlists/${plannedSet}`)).status === 200);
check("…its coming empty sets go", (await call(admin, "GET", `/setlists/${after[0].setlistId}`)).status === 404);

finish();
