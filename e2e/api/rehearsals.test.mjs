// Rehearsals (issue #235, phase 7): an event tied to another, some days
// before each of its dates. No answers, line-up or set of its own: it opens
// its date's set, and the people signed up for that date (on its line-up,
// or answered Available) see it - on My calendar and in their calendar
// link. It goes with its event.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const today = new Date().toISOString().slice(0, 10);
const plus = (days) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

const admin = await user("rehearsal admin");
const singer = await user("rehearsal singer");
const drummer = await user("rehearsal drummer");
const team = (await call(admin, "POST", "/teams", { name: `Rehearsals ${stamp}` })).body;
for (const [n, member] of [singer, drummer].entries()) {
  sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tmr${n}${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
}
const first = plus(7);
const event = (await call(admin, "POST", `/teams/${team.id}/events`, { title: "Sunday", date: first, startTime: "10:00", timeZone: "UTC", repeat: { everyWeeks: 1 } })).body;
const base = `/teams/${team.id}/events`;
await call(singer, "PUT", `${base}/${event.id}/dates/${first}/answer`, { answer: "AVAILABLE" });

let r = await call(admin, "POST", base, { title: "Band practice", date: first, startTime: "19:30", durationMinutes: 90, timeZone: "UTC", rehearsalFor: { eventId: event.id, daysBefore: 3 } });
const rehearsal = r.body;
check("a rehearsal for an event, 3 days before", r.status === 201 && rehearsal.rehearsalFor?.eventId === event.id && rehearsal.rehearsalFor.daysBefore === 3 && rehearsal.repeat === null, JSON.stringify(r.body));
r = await call(admin, "POST", base, { title: "Too early", date: first, startTime: "19:30", timeZone: "UTC", rehearsalFor: { eventId: event.id, daysBefore: 15 } });
check("more than 14 days before: refused", r.status === 400, String(r.status));
r = await call(admin, "POST", base, { title: "Of a rehearsal", date: first, startTime: "19:30", timeZone: "UTC", rehearsalFor: { eventId: rehearsal.id, daysBefore: 1 } });
check("a rehearsal for a rehearsal: refused", r.status === 400, String(r.status));
const other = (await call(admin, "POST", "/teams", { name: `Other ${stamp}` })).body;
r = await call(admin, "POST", `/teams/${other.id}/events`, { title: "Elsewhere", date: first, startTime: "19:30", timeZone: "UTC", rehearsalFor: { eventId: event.id, daysBefore: 1 } });
check("for another team's event: refused", r.status === 400, String(r.status));

const dates = (await call(admin, "GET", `/teams/${team.id}/event-dates?from=${today}&to=${plus(16)}`)).body;
const practices = dates.filter((one) => one.eventId === rehearsal.id);
const sunday = dates.find((one) => one.eventId === event.id && one.date === first);
check("its dates: 3 days before each of the event's", practices.map((one) => one.date).join() === [plus(4), plus(11)].join() && practices[0].startsAt === `${plus(4)}T19:30:00.000Z`, JSON.stringify(practices.map((one) => [one.date, one.startsAt])));
check("…each saying which date it's for", practices[0].rehearsalFor?.eventId === event.id && practices[0].rehearsalFor.date === first && practices[0].rehearsalFor.title === "Sunday" && sunday.rehearsalFor === null, JSON.stringify(practices[0].rehearsalFor));
await call(admin, "POST", `${base}/${event.id}/dates/${first}/set`);
const setlistId = (await call(admin, "GET", `/teams/${team.id}/event-dates?from=${first}&to=${first}`)).body.find((one) => one.eventId === event.id).setlistId;
const practice = (await call(admin, "GET", `/teams/${team.id}/event-dates?from=${plus(4)}&to=${plus(4)}`)).body.find((one) => one.eventId === rehearsal.id);
check("it opens its date's set", !!setlistId && practice.setlistId === setlistId, `${setlistId} ${practice.setlistId}`);
r = await call(singer, "PUT", `${base}/${rehearsal.id}/dates/${plus(4)}/answer`, { answer: "AVAILABLE" });
check("no answers to a rehearsal", r.status === 400, String(r.status));
r = await call(admin, "PATCH", `${base}/${rehearsal.id}/dates/${plus(4)}`, { cancelled: true });
check("no date of its own to change", r.status === 400, String(r.status));
r = await call(admin, "POST", `${base}/${rehearsal.id}/dates/${plus(4)}/set`);
check("no set of its own", r.status === 400, String(r.status));

const mine = async (who) => (await call(who, "GET", `/users/me/event-dates?from=${today}&to=${plus(16)}`)).body.filter((one) => one.eventId === rehearsal.id);
let seen = await mine(singer);
check("My calendar: signed up for the date, the rehearsal before it", seen.length === 1 && seen[0].date === plus(4) && seen[0].rehearsalFor?.date === first && seen[0].setlistId === setlistId, JSON.stringify(seen.map((one) => one.date)));
check("…not for someone who isn't", (await mine(drummer)).length === 0);

r = await call(singer, "POST", "/users/me/calendar-feed");
const feed = (await (await fetch(r.body.url)).text()).replace(/\r\n /g, "");
check("the calendar link has it too", feed.includes(`UID:${rehearsal.id}-${plus(4)}@songverse`) && feed.includes("SUMMARY:Band practice"), feed.split("\r\n").filter((l) => /^(UID|SUMMARY)/.test(l)).join(" | "));

await call(admin, "PATCH", `${base}/${event.id}/dates/${first}`, { cancelled: true });
seen = (await call(admin, "GET", `/teams/${team.id}/event-dates?from=${plus(4)}&to=${plus(4)}`)).body.find((one) => one.eventId === rehearsal.id);
check("the date cancelled: its rehearsal too", seen?.cancelled === true, JSON.stringify(seen));
await call(admin, "PATCH", `${base}/${event.id}/dates/${first}`, { cancelled: false });

r = await call(admin, "PATCH", `${base}/${rehearsal.id}`, { rehearsalFor: null, repeat: null });
check("no longer a rehearsal: an event of its own", r.status === 200 && r.body.rehearsalFor === null, JSON.stringify(r.body));
r = await call(admin, "PATCH", `${base}/${rehearsal.id}`, { rehearsalFor: { eventId: event.id, daysBefore: 1 } });
check("…and a rehearsal again, 1 day before", r.status === 200 && r.body.rehearsalFor?.daysBefore === 1, JSON.stringify(r.body));

r = await call(admin, "DELETE", `${base}/${event.id}`);
check("the event deleted: its rehearsals with it", r.status === 204 && (await call(admin, "GET", `/teams/${team.id}/events`)).body.every((one) => one.id !== rehearsal.id), String(r.status));

finish();
